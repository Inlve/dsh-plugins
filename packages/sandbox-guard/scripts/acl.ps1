# Workspace ACL readiness for the DSH Windows sandbox.
#
# The Windows sandbox backend grants a workspace write capability with one
# SetNamedSecurityInfoW call carrying a DACL allow ACE, a delete deny and an
# integrity label. That call needs the caller to own the directory and to hold
# WRITE_OWNER on it. An owner only receives READ_CONTROL and WRITE_DAC
# implicitly, so a directory whose DACL grants just Modify fails the grant with
# Win32 5 and every confined command in it fails before it starts.
#
# This script observes that precondition and, in prepare mode, restores it by
# adding one inheritable FullControl allow ACE for the signed-in user. Nothing
# else is changed: owner, denies, SACL, inheritance flags and other principals
# stay as they are. Every change is backed up and verified by re-reading.
#
# The DACL is written with SetNamedSecurityInfoW and DACL_SECURITY_INFORMATION
# only. Set-Acl persists whatever sections the object carries, which includes
# the sandbox integrity label and needs SeSecurityPrivilege the user does not
# have; this path never requests the SACL.
#
# Output contract: exactly one line on stdout, `ACL_RESULT <compact json>`.
# The caller parses that marker; any other output is diagnostics only.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][ValidateSet('check', 'prepare', 'reach', 'reach_repair', 'trust_check', 'trust_grant', 'trust_revoke')][string]$Mode,
    [string]$Source = '',
    [string]$BackupDir = '',
    [string]$OutFile = '',
    [int]$AncestorDepth = 3,
    [int]$MaxObjects = 5000
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
try { $OutputEncoding = [Console]::OutputEncoding } catch { }

# Windows PowerShell 5.1 can refuse implicit module autoloading while
# $ErrorActionPreference is Stop; load the modules this script uses first.
foreach ($moduleName in 'Microsoft.PowerShell.Security', 'Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Management') {
    try { Import-Module $moduleName -ErrorAction Stop } catch { }
}

$MARKER = 'ACL_RESULT '
$PERMISSIONS_MASK = [int][System.Security.AccessControl.FileSystemRights]::ChangePermissions
$OWNERSHIP_MASK = [int][System.Security.AccessControl.FileSystemRights]::TakeOwnership
$GENERIC_ALL = 0x10000000
$FULL_CONTROL = [System.Security.AccessControl.FileSystemRights]::FullControl
$ACCESS_SECTIONS = [System.Security.AccessControl.AccessControlSections]::Access

$ACL_NATIVE_SOURCE = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class WorkspaceAclNative
{
    private const int SE_FILE_OBJECT = 1;
    private const uint DACL_SECURITY_INFORMATION = 0x00000004;
    private const uint PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;
    private const uint UNPROTECTED_DACL_SECURITY_INFORMATION = 0x20000000;

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(
        string StringSecurityDescriptor, uint StringSDRevision, out IntPtr SecurityDescriptor, out uint SecurityDescriptorSize);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetSecurityDescriptorDacl(
        IntPtr pSecurityDescriptor, out bool lpbDaclPresent, out IntPtr pDacl, out bool lpbDaclDefaulted);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern uint SetNamedSecurityInfoW(
        string pObjectName, int ObjectType, uint SecurityInfo,
        IntPtr psidOwner, IntPtr psidGroup, IntPtr pDacl, IntPtr pSacl);

    [DllImport("kernel32.dll", SetLastError = false)]
    private static extern IntPtr LocalFree(IntPtr hMem);

    public static void SetDacl(string path, string daclSddl)
    {
        if (string.IsNullOrEmpty(path)) throw new ArgumentNullException("path");
        if (string.IsNullOrEmpty(daclSddl)) throw new ArgumentNullException("daclSddl");

        bool protect = daclSddl.StartsWith("D:P", StringComparison.Ordinal);
        IntPtr descriptor = IntPtr.Zero;
        try
        {
            uint size;
            if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(daclSddl, 1, out descriptor, out size))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "ConvertStringSecurityDescriptorToSecurityDescriptor failed");

            bool present;
            IntPtr dacl;
            bool defaulted;
            if (!GetSecurityDescriptorDacl(descriptor, out present, out dacl, out defaulted))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "GetSecurityDescriptorDacl failed");

            uint info = DACL_SECURITY_INFORMATION |
                (protect ? PROTECTED_DACL_SECURITY_INFORMATION : UNPROTECTED_DACL_SECURITY_INFORMATION);
            uint status = SetNamedSecurityInfoW(path, SE_FILE_OBJECT, info, IntPtr.Zero, IntPtr.Zero,
                present ? dacl : IntPtr.Zero, IntPtr.Zero);
            if (status != 0) throw new Win32Exception((int)status, "SetNamedSecurityInfo failed");
        }
        finally
        {
            if (descriptor != IntPtr.Zero) LocalFree(descriptor);
        }
    }
}
'@

$script:AclNativeReady = $false
$script:AclStep = 'inspect'

function Emit-Result {
    param($Result)
    $json = $Result | ConvertTo-Json -Compress -Depth 8
    $line = $MARKER + $json
    [Console]::Out.WriteLine($line)
    if (-not [string]::IsNullOrEmpty($OutFile)) {
        # Optional copy for callers that cannot capture stdout (CI, tests).
        try { Set-Content -LiteralPath $OutFile -Value $line -Encoding UTF8 } catch { }
    }
}

function Initialize-AclNative {
    if ($script:AclNativeReady) { return }
    Add-Type -TypeDefinition $ACL_NATIVE_SOURCE -Language CSharp | Out-Null
    $script:AclNativeReady = $true
}

function Get-SidText {
    param($Identity)
    try { return $Identity.Translate([System.Security.Principal.SecurityIdentifier]).Value }
    catch { return $null }
}

function Get-OwnerSidText {
    param([string]$Owner)
    if ([string]::IsNullOrWhiteSpace($Owner)) { return $null }
    try {
        $account = New-Object System.Security.Principal.NTAccount($Owner)
        return $account.Translate([System.Security.Principal.SecurityIdentifier]).Value
    }
    catch {
        # An unresolved owner name is still a usable comparison key.
        return $Owner
    }
}

function Test-Granted {
    param($Acl, [string]$UserSid, [string[]]$GroupSids, [int]$Mask)
    if ($null -eq $Acl) { return $false }
    $allow = $false
    $deny = $false
    foreach ($rule in $Acl.Access) {
        $sid = Get-SidText $rule.IdentityReference
        if ($null -eq $sid) { continue }
        if ($sid -ne $UserSid -and ($GroupSids -notcontains $sid)) { continue }
        $rights = [int]$rule.FileSystemRights
        $coversMask = (($rights -band $Mask) -eq $Mask) -or (($rights -band $GENERIC_ALL) -ne 0)
        if (-not $coversMask) { continue }
        if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny) { $deny = $true }
        else { $allow = $true }
    }
    if ($deny) { return $false }
    return $allow
}

function Get-AncestorTrace {
    param([string]$FullPath, [string]$UserSid, [string[]]$GroupSids, [int]$Depth)
    $trace = @()
    $current = $FullPath
    for ($index = 0; $index -lt $Depth; $index++) {
        $parent = Split-Path -Parent $current
        if ([string]::IsNullOrEmpty($parent) -or $parent -eq $current) { break }
        $current = $parent
        $entry = [ordered]@{ path = $current }
        try {
            $acl = Get-Acl -LiteralPath $current
            $isOwner = ((Get-OwnerSidText $acl.Owner) -eq $UserSid)
            $entry.isOwner = $isOwner
            $entry.writeDac = $isOwner -or (Test-Granted $acl $UserSid $GroupSids $PERMISSIONS_MASK)
            $entry.writeOwner = Test-Granted $acl $UserSid $GroupSids $OWNERSHIP_MASK
        }
        catch {
            $entry.error = $_.Exception.Message
        }
        $trace += $entry
    }
    return , $trace
}

function Get-Readiness {
    param([bool]$IsOwner, [bool]$WriteDac, [bool]$WriteOwner, [bool]$NullDacl)
    if ($NullDacl) { return 'null-dacl' }
    if ($IsOwner -and $WriteDac -and $WriteOwner) { return 'ready' }
    if ($WriteDac) { return 'needs-grant' }
    return 'blocked'
}

function New-UserFullControlRule {
    param([string]$UserSid)
    $sid = New-Object System.Security.Principal.SecurityIdentifier($UserSid)
    $inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $propagate = [System.Security.AccessControl.PropagationFlags]::None
    return New-Object System.Security.AccessControl.FileSystemAccessRule(
        $sid, $FULL_CONTROL, $inherit, $propagate,
        [System.Security.AccessControl.AccessControlType]::Allow)
}

function Get-DaclSddl {
    param([string]$TargetPath)
    $acl = Get-Acl -LiteralPath $TargetPath
    return $acl.GetSecurityDescriptorSddlForm($ACCESS_SECTIONS)
}

function New-DaclSddl {
    param([string]$DaclSddl, $Add)
    $descriptor = New-Object System.Security.AccessControl.DirectorySecurity
    $descriptor.SetSecurityDescriptorSddlForm($DaclSddl, $ACCESS_SECTIONS)
    if ($null -ne $Add) { $descriptor.AddAccessRule($Add) }
    return $descriptor.GetSecurityDescriptorSddlForm($ACCESS_SECTIONS)
}

function Write-DaclSddl {
    # DACL-only write: the owner's implicit WRITE_DAC is enough, no SACL access.
    param([string]$TargetPath, [string]$DaclSddl)
    Initialize-AclNative
    [WorkspaceAclNative]::SetDacl($TargetPath, $DaclSddl)
}

# The workspace grant is one standing ACE plus one Low integrity label on the
# root. Children created afterwards inherit both; children that already existed
# when the grant was applied do not. A confined (Low) child cannot write into
# such a directory, so a build fails with an access error even though the
# workspace root itself is ready.
$LABEL_NATIVE_SOURCE = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class WorkspaceLabelNative
{
    private const int SE_FILE_OBJECT = 1;
    private const uint LABEL_SECURITY_INFORMATION = 0x00000010;

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern uint GetNamedSecurityInfoW(
        string pObjectName, int ObjectType, uint SecurityInfo,
        out IntPtr ppsidOwner, out IntPtr ppsidGroup, out IntPtr ppDacl, out IntPtr ppSacl,
        out IntPtr ppSecurityDescriptor);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetSecurityDescriptorSacl(
        IntPtr pSecurityDescriptor, out bool lpbSaclPresent, out IntPtr pSacl, out bool lpbSaclDefaulted);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(
        string StringSecurityDescriptor, uint StringSDRevision, out IntPtr SecurityDescriptor, out uint SecurityDescriptorSize);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(
        IntPtr SecurityDescriptor, uint StringSDRevision, uint SecurityInformation,
        out IntPtr StringSecurityDescriptor, out uint StringSecurityDescriptorLen);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern uint SetNamedSecurityInfoW(
        string pObjectName, int ObjectType, uint SecurityInfo,
        IntPtr psidOwner, IntPtr psidGroup, IntPtr pDacl, IntPtr pSacl);

    [DllImport("kernel32.dll", SetLastError = false)]
    private static extern IntPtr LocalFree(IntPtr hMem);

    public static string ReadLabel(string path)
    {
        IntPtr owner, group, dacl, sacl, sd;
        uint rc = GetNamedSecurityInfoW(path, SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION, out owner, out group, out dacl, out sacl, out sd);
        if (rc != 0) throw new Win32Exception((int)rc, "GetNamedSecurityInfo(label) failed");
        try
        {
            if (sacl == IntPtr.Zero) return string.Empty;
            IntPtr text; uint length;
            if (!ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, 1, LABEL_SECURITY_INFORMATION, out text, out length))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "label to SDDL failed");
            try { return Marshal.PtrToStringUni(text) ?? string.Empty; }
            finally { LocalFree(text); }
        }
        finally { LocalFree(sd); }
    }

    public static void SetLabel(string path, string labelSddl)
    {
        IntPtr sd = IntPtr.Zero;
        try
        {
            uint size;
            if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(labelSddl, 1, out sd, out size))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "label SDDL rejected");
            bool present; IntPtr sacl; bool defaulted;
            if (!GetSecurityDescriptorSacl(sd, out present, out sacl, out defaulted))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "GetSecurityDescriptorSacl failed");
            uint rc = SetNamedSecurityInfoW(path, SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION,
                IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, present ? sacl : IntPtr.Zero);
            if (rc != 0) throw new Win32Exception((int)rc, "SetNamedSecurityInfo(label) failed");
        }
        finally { if (sd != IntPtr.Zero) LocalFree(sd); }
    }

    public static void ClearLabel(string path)
    {
        uint rc = SetNamedSecurityInfoW(path, SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION,
            IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        if (rc != 0) throw new Win32Exception((int)rc, "SetNamedSecurityInfo(clear label) failed");
    }
}
'@

$script:LabelNativeReady = $false

function Initialize-LabelNative {
    if ($script:LabelNativeReady) { return }
    Add-Type -TypeDefinition $LABEL_NATIVE_SOURCE -Language CSharp | Out-Null
    $script:LabelNativeReady = $true
}

function Get-LabelSddl {
    param([string]$TargetPath)
    Initialize-LabelNative
    return [WorkspaceLabelNative]::ReadLabel($TargetPath)
}

function Get-LabelAce {
    # "S:AI(ML;OICI;NW;;;LW)" -> "(ML;OICI;NW;;;LW)" for re-writing the same label.
    param([string]$LabelSddl)
    if ([string]::IsNullOrEmpty($LabelSddl)) { return '' }
    $index = $LabelSddl.IndexOf('(')
    if ($index -lt 0) { return '' }
    return $LabelSddl.Substring($index)
}

function Get-LabelKey {
    # Mask and SID decide whether a Low child may write; inheritance flags and the
    # inherited (ID) bit do not, so an inherited copy must compare equal.
    param([string]$LabelSddl)
    if ([string]::IsNullOrEmpty($LabelSddl)) { return '' }
    $index = $LabelSddl.IndexOf('(')
    if ($index -lt 0) { return '' }
    $ace = $LabelSddl.Substring($index).Trim('(', ')')
    $parts = $ace.Split(';')
    if ($parts.Count -lt 6) { return '' }
    return ($parts[2] + ':' + $parts[5])
}

function Get-SandboxGrant {
    param($Acl)
    foreach ($entry in $Acl.Access) {
        $sid = Get-SidText $entry.IdentityReference
        if ($null -ne $sid -and $sid.StartsWith('S-1-4-')) {
            return [ordered]@{
                sid = $sid
                mask = [int]$entry.FileSystemRights
                inheritance = [string]$entry.InheritanceFlags
                propagation = [string]$entry.PropagationFlags
            }
        }
    }
    return $null
}

function Invoke-Trust {
    # Extend one trusted directory with the sandbox write grant of an existing
    # workspace: the same capability-SID allow ACE and the same Low integrity
    # label. The workspace SID is read from the source workspace, never derived
    # here, so this cannot drift from the sandbox's own identity scheme.
    #
    # Deliberately narrow: it only ever ADDS the capability ACE and the label.
    # Revoking removes exactly that SID's ACEs, and clears the label only when no
    # capability ACE remains on the directory.
    param([string]$Target, [string]$Source, [string]$Mode, [string]$UserSid, [string[]]$GroupSids, [string]$BackupDir)

    $state = [ordered]@{
        target   = $Target
        source   = $Source
        mode     = $Mode
        grant    = $null
        label    = ''
        hasAce   = $false
        hasLabel = $false
        granted  = $false
        changed  = $false
        verified = $false
        backup   = $null
    }

    $sourceAcl = Get-Acl -LiteralPath $Source
    $grant = Get-SandboxGrant $sourceAcl
    $sourceLabelSddl = Get-LabelSddl $Source
    $sourceLabelAce = Get-LabelAce $sourceLabelSddl
    $sourceLabelKey = Get-LabelKey $sourceLabelSddl
    $state.grant = $grant
    $state.label = $sourceLabelAce
    if ($null -eq $grant) {
        $state.note = 'the source workspace carries no sandbox capability ACE yet; run one confined command there, then retry'
        return $state
    }
    if ([string]::IsNullOrEmpty($sourceLabelKey) -or [string]::IsNullOrEmpty($sourceLabelAce)) {
        $state.note = 'the source workspace carries no integrity label to copy'
        return $state
    }

    $acl = Get-Acl -LiteralPath $Target
    foreach ($entry in $acl.Access) {
        if ((Get-SidText $entry.IdentityReference) -eq $grant.sid) { $state.hasAce = $true; break }
    }
    $targetLabelKey = ''
    try { $targetLabelKey = Get-LabelKey (Get-LabelSddl $Target) } catch { }
    $state.hasLabel = ($targetLabelKey -eq $sourceLabelKey)
    $state.granted = ($state.hasAce -and $state.hasLabel)
    if ($Mode -eq 'trust_check') { return $state }
    # A revoke must run even when the grant is present; only check/grant may
    # short-circuit on an already satisfied state.
    if ($state.granted -and $Mode -ne 'trust_revoke') { return $state }

    # The label write needs WRITE_OWNER, and an owner does not hold it
    # implicitly. Never take ownership: refuse instead.
    $ownerSid = Get-OwnerSidText $acl.Owner
    $writeOwner = Test-Granted $acl $UserSid $GroupSids $OWNERSHIP_MASK
    if (-not ($ownerSid -eq $UserSid -or $writeOwner)) {
        $state.error = [ordered]@{
            code    = 'needs-owner-rights'
            message = 'the signed-in user does not hold WRITE_OWNER on this directory; writing the integrity label needs it, and this plugin never takes ownership'
        }
        return $state
    }

    if ($Mode -eq 'trust_revoke') {
        $descriptor = New-Object System.Security.AccessControl.DirectorySecurity
        $descriptor.SetSecurityDescriptorSddlForm($acl.GetSecurityDescriptorSddlForm($ACCESS_SECTIONS), $ACCESS_SECTIONS)
        $removed = 0
        foreach ($rule in @($descriptor.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))) {
            if ($rule.IdentityReference.Value -eq $grant.sid) { $descriptor.RemoveAccessRule($rule) | Out-Null; $removed++ }
        }
        if ($removed -gt 0) {
            Write-DaclSddl -TargetPath $Target -DaclSddl $descriptor.GetSecurityDescriptorSddlForm($ACCESS_SECTIONS)
            $state.changed = $true
        }
        $after = Get-Acl -LiteralPath $Target
        $thisSidRemains = $false
        $anyCapability = $false
        foreach ($entry in $after.Access) {
            $sid = Get-SidText $entry.IdentityReference
            if ($null -eq $sid -or -not $sid.StartsWith('S-1-4-')) { continue }
            $anyCapability = $true
            if ($sid -eq $grant.sid) { $thisSidRemains = $true }
        }
        if (-not $anyCapability -and $state.hasLabel) {
            [WorkspaceLabelNative]::ClearLabel($Target)
            $state.labelCleared = $true
            $state.changed = $true
        }
        $state.removedAces = $removed
        $state.remainingCapabilityAces = [bool]$anyCapability
        $state.thisWorkspaceAceRemains = [bool]$thisSidRemains
        # "verified" means THIS workspace's identity is gone; other workspaces may
        # still hold their own ACEs on the same directory.
        $state.verified = (-not $thisSidRemains)
        return $state
    }

    $addedAce = $false
    $addedLabel = $false
    if (-not $state.hasAce) {
        $current = Get-Acl -LiteralPath $Target
        $descriptor = New-Object System.Security.AccessControl.DirectorySecurity
        $descriptor.SetSecurityDescriptorSddlForm($current.GetSecurityDescriptorSddlForm($ACCESS_SECTIONS), $ACCESS_SECTIONS)
        $capRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            (New-Object System.Security.Principal.SecurityIdentifier($grant.sid)),
            [System.Security.AccessControl.FileSystemRights]$grant.mask,
            [System.Security.AccessControl.InheritanceFlags]$grant.inheritance,
            [System.Security.AccessControl.PropagationFlags]$grant.propagation,
            [System.Security.AccessControl.AccessControlType]::Allow)
        $descriptor.AddAccessRule($capRule)
        Write-DaclSddl -TargetPath $Target -DaclSddl $descriptor.GetSecurityDescriptorSddlForm($ACCESS_SECTIONS)
        $addedAce = $true
    }
    if (-not $state.hasLabel) {
        [WorkspaceLabelNative]::SetLabel($Target, 'S:' + $sourceLabelAce)
        $addedLabel = $true
    }

    $after = Get-Acl -LiteralPath $Target
    $afterAce = $false
    foreach ($entry in $after.Access) {
        if ((Get-SidText $entry.IdentityReference) -eq $grant.sid) { $afterAce = $true; break }
    }
    $afterLabel = ((Get-LabelKey (Get-LabelSddl $Target)) -eq $sourceLabelKey)
    $state.changed = ($addedAce -or $addedLabel)
    $state.verified = ($afterAce -and $afterLabel)
    $state.granted = $state.verified
    if ($state.changed) {
        $state.backup = Write-ReachBackup -Root $Target -Grant $grant -Label $sourceLabelAce `
            -Changed @([ordered]@{ path = $Target; addedAce = $addedAce; addedLabel = $addedLabel }) -BackupDir $BackupDir
    }
    return $state
}

function Invoke-Reach {
    param([string]$Root, [string]$UserSid, [string[]]$GroupSids, [string]$Mode, [int]$MaxObjects, [string]$BackupDir)

    $rootAcl = Get-Acl -LiteralPath $Root
    $grant = Get-SandboxGrant $rootAcl
    $rootLabelSddl = Get-LabelSddl $Root
    $rootLabelAce = Get-LabelAce $rootLabelSddl
    $rootLabelKey = Get-LabelKey $rootLabelSddl

    $state = [ordered]@{
        objects = 0
        missingAce = 0
        missingLabel = 0
        missingBoth = 0
        repaired = 0
        failed = 0
        truncated = $false
        samples = @()
        failures = @()
    }
    $state.grant = $grant
    $state.label = $rootLabelAce
    if ($null -eq $grant) {
        $state.note = 'the workspace root carries no sandbox capability ACE yet; run one confined command first, then retry'
        return $state
    }
    if ([string]::IsNullOrEmpty($rootLabelKey)) {
        $state.note = 'the workspace root carries no integrity label to copy'
        return $state
    }

    $queue = New-Object System.Collections.Generic.Queue[string]
    $queue.Enqueue($Root)
    $dirs = New-Object System.Collections.Generic.List[string]
    while ($queue.Count -gt 0) {
        if ($dirs.Count -ge $MaxObjects) { $state.truncated = $true; break }
        $dir = $queue.Dequeue()
        $dirs.Add($dir)
        try {
            foreach ($child in [System.IO.Directory]::EnumerateDirectories($dir)) {
                $attributes = [System.IO.File]::GetAttributes($child)
                if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
                $queue.Enqueue($child)
            }
        } catch { }
    }

    $changed = New-Object System.Collections.Generic.List[object]
    $userSidObject = New-Object System.Security.Principal.SecurityIdentifier($UserSid)

    foreach ($dir in $dirs) {
        $state.objects++
        $acl = $null
        try { $acl = Get-Acl -LiteralPath $dir } catch { $state.failed++; continue }

        $hasAce = $false
        foreach ($entry in $acl.Access) {
            if ((Get-SidText $entry.IdentityReference) -eq $grant.sid) { $hasAce = $true; break }
        }
        $labelKey = ''
        try { $labelKey = Get-LabelKey (Get-LabelSddl $dir) } catch { }
        $hasLabel = ($rootLabelKey -ne '' -and $labelKey -eq $rootLabelKey)

        if ($hasAce -and $hasLabel) { continue }
        if (-not $hasAce) { $state.missingAce++ }
        if (-not $hasLabel) { $state.missingLabel++ }
        if (-not $hasAce -and -not $hasLabel) { $state.missingBoth++ }
        if ($state.samples.Count -lt 12) { $state.samples += $dir }
        if ($Mode -ne 'reach_repair') { continue }

        $addedAce = $false
        $addedLabel = $false
        try {
            if (-not (Test-Granted $acl $UserSid $GroupSids $OWNERSHIP_MASK)) {
                # The label write needs WRITE_OWNER, which an owner does not hold implicitly.
                $descriptor = New-Object System.Security.AccessControl.DirectorySecurity
                $descriptor.SetSecurityDescriptorSddlForm($acl.GetSecurityDescriptorSddlForm($ACCESS_SECTIONS), $ACCESS_SECTIONS)
                $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                    $userSidObject, $FULL_CONTROL,
                    [System.Security.AccessControl.InheritanceFlags]::None,
                    [System.Security.AccessControl.PropagationFlags]::None,
                    [System.Security.AccessControl.AccessControlType]::Allow)
                $descriptor.AddAccessRule($rule)
                Write-DaclSddl -TargetPath $dir -DaclSddl $descriptor.GetSecurityDescriptorSddlForm($ACCESS_SECTIONS)
            }
            if (-not $hasAce) {
                $current = Get-Acl -LiteralPath $dir
                $descriptor = New-Object System.Security.AccessControl.DirectorySecurity
                $descriptor.SetSecurityDescriptorSddlForm($current.GetSecurityDescriptorSddlForm($ACCESS_SECTIONS), $ACCESS_SECTIONS)
                $capRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                    (New-Object System.Security.Principal.SecurityIdentifier($grant.sid)),
                    [System.Security.AccessControl.FileSystemRights]$grant.mask,
                    [System.Security.AccessControl.InheritanceFlags]$grant.inheritance,
                    [System.Security.AccessControl.PropagationFlags]$grant.propagation,
                    [System.Security.AccessControl.AccessControlType]::Allow)
                $descriptor.AddAccessRule($capRule)
                Write-DaclSddl -TargetPath $dir -DaclSddl $descriptor.GetSecurityDescriptorSddlForm($ACCESS_SECTIONS)
                $addedAce = $true
            }
            if (-not $hasLabel) {
                [WorkspaceLabelNative]::SetLabel($dir, 'S:' + $rootLabelAce)
                $addedLabel = $true
            }

            $after = Get-Acl -LiteralPath $dir
            $afterAce = $false
            foreach ($entry in $after.Access) {
                if ((Get-SidText $entry.IdentityReference) -eq $grant.sid) { $afterAce = $true; break }
            }
            $afterLabel = ((Get-LabelKey (Get-LabelSddl $dir)) -eq $rootLabelKey)
            if ($afterAce -and $afterLabel) {
                $state.repaired++
                if ($addedAce -or $addedLabel) {
                    $changed.Add([ordered]@{ path = $dir; addedAce = $addedAce; addedLabel = $addedLabel })
                }
            } else {
                $state.failed++
                if ($state.failures.Count -lt 8) { $state.failures += [ordered]@{ path = $dir; error = 'verification failed' } }
            }
        } catch {
            $state.failed++
            if ($state.failures.Count -lt 8) { $state.failures += [ordered]@{ path = $dir; error = $_.Exception.Message } }
        }
    }

    if ($Mode -eq 'reach_repair' -and $changed.Count -gt 0) {
        $state.changedCount = $changed.Count
        $state.backup = Write-ReachBackup -Root $Root -Grant $grant -Label $rootLabelAce -Changed $changed -BackupDir $BackupDir
    }
    return $state
}

function Write-ReachBackup {
    param([string]$Root, $Grant, [string]$Label, $Changed, [string]$BackupDir)
    if ([string]::IsNullOrEmpty($BackupDir)) { return $null }
    if (-not (Test-Path -LiteralPath $BackupDir)) {
        New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    }
    $id = ([guid]::NewGuid().ToString('n')).Substring(0, 16)
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
    $base = "acl-reach-$stamp-$id"
    $jsonPath = Join-Path $BackupDir ($base + '.json')
    $ps1Path = Join-Path $BackupDir ($base + '.restore.ps1')

    $record = [ordered]@{
        at = (Get-Date).ToUniversalTime().ToString('o')
        root = $Root
        grant = $Grant
        label = $Label
        changed = $Changed
    }
    $record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

    $restoreHead = @'
param([Parameter(Mandatory = $true)][string]$Record)
$ErrorActionPreference = 'Stop'

'@
    $restoreBody = @'
Add-Type -TypeDefinition $aclNative -Language CSharp | Out-Null
Add-Type -TypeDefinition $labelNative -Language CSharp | Out-Null
$rec = Get-Content -Raw -LiteralPath $Record | ConvertFrom-Json
$sections = [System.Security.AccessControl.AccessControlSections]::Access
foreach ($item in $rec.changed) {
    $acl = Get-Acl -LiteralPath $item.path
    $descriptor = New-Object System.Security.AccessControl.DirectorySecurity
    $descriptor.SetSecurityDescriptorSddlForm($acl.GetSecurityDescriptorSddlForm($sections), $sections)
    foreach ($rule in @($descriptor.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))) {
        if ($rule.IdentityReference.Value -eq $rec.grant.sid) { $descriptor.RemoveAccessRule($rule) | Out-Null }
    }
    [WorkspaceAclNative]::SetDacl($item.path, $descriptor.GetSecurityDescriptorSddlForm($sections))
    if ($item.addedLabel) { [WorkspaceLabelNative]::ClearLabel($item.path) }
}
Write-Output "restored $($rec.changed.Count) directories under $($rec.root)"
'@

    $restore = $restoreHead +
        "`$aclNative = @'`n" + $ACL_NATIVE_SOURCE + "`n'@`n" +
        "`$labelNative = @'`n" + $LABEL_NATIVE_SOURCE + "`n'@`n" +
        $restoreBody
    Set-Content -LiteralPath $ps1Path -Value $restore -Encoding UTF8

    return [ordered]@{
        record = $jsonPath
        script = $ps1Path
        rollback = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$ps1Path`" -Record `"$jsonPath`""
    }
}

function Write-Backup {
    param([string]$TargetPath, [string]$UserSid, [string]$Owner, [string]$Sddl, [string]$DaclSddl, [string]$BackupDir)
    if ([string]::IsNullOrEmpty($BackupDir)) { return $null }
    if (-not (Test-Path -LiteralPath $BackupDir)) {
        New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    }
    $id = ([guid]::NewGuid().ToString('n')).Substring(0, 16)
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
    $base = "acl-backup-$stamp-$id"
    $jsonPath = Join-Path $BackupDir ($base + '.json')
    $ps1Path = Join-Path $BackupDir ($base + '.restore.ps1')

    $record = [ordered]@{
        path       = $TargetPath
        at         = (Get-Date).ToUniversalTime().ToString('o')
        user       = $UserSid
        owner      = $Owner
        sddlBefore = $Sddl
        daclBefore = $DaclSddl
        addedRule  = [ordered]@{
            sid         = $UserSid
            rights      = 'FullControl'
            inheritance = 'ContainerInherit,ObjectInherit'
            propagation = 'None'
            type        = 'Allow'
        }
    }
    $record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

    $restoreHead = @'
param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$RuleJson
)
$ErrorActionPreference = 'Stop'

'@
    $restoreBody = @'
$record = Get-Content -Raw -LiteralPath $RuleJson | ConvertFrom-Json
if ([string]::IsNullOrEmpty($record.daclBefore)) {
    throw "The backup record has no daclBefore field; nothing was restored."
}

Add-Type -TypeDefinition $native -Language CSharp | Out-Null
[WorkspaceAclNative]::SetDacl($Path, $record.daclBefore)
Write-Output "restored the DACL recorded at $($record.at) on $Path"
'@

    $restore = $restoreHead + "`$native = @'" + "`n" + $ACL_NATIVE_SOURCE + "`n'@" + "`n" + $restoreBody
    Set-Content -LiteralPath $ps1Path -Value $restore -Encoding UTF8

    return [ordered]@{
        record = $jsonPath
        script = $ps1Path
        rollback = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$ps1Path`" -Path `"$TargetPath`" -RuleJson `"$jsonPath`""
    }
}

$targetPath = $Path
try { $targetPath = [System.IO.Path]::GetFullPath($Path) } catch { }
$result = [ordered]@{
    ok        = $false
    mode      = $Mode
    path      = $targetPath
    readiness = 'unknown'
    platform  = 'windows'
}

try {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $userSid = $identity.User.Value
    $groupSids = @($identity.Groups | ForEach-Object { $_.Value })
    $result.currentUser = $userSid
    $result.isAdmin = (New-Object System.Security.Principal.WindowsPrincipal($identity)).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)

    if (-not (Test-Path -LiteralPath $targetPath)) {
        $result.readiness = 'missing'
        $result.ok = $true
        Emit-Result $result
        exit 0
    }

    $item = Get-Item -LiteralPath $targetPath -Force
    $result.exists = $true
    $result.reparsePoint = [bool]($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
    $result.isDirectory = [bool]$item.PSIsContainer

    if ($result.reparsePoint) {
        $result.readiness = 'reparse-point'
        $result.ok = $true
        Emit-Result $result
        exit 0
    }
    if (-not $result.isDirectory) {
        $result.readiness = 'not-directory'
        $result.ok = $true
        Emit-Result $result
        exit 0
    }

    if ($Mode -eq 'reach' -or $Mode -eq 'reach_repair') {
        $script:AclStep = 'reach'
        $reach = Invoke-Reach -Root $targetPath -UserSid $userSid -GroupSids $groupSids -Mode $Mode -MaxObjects $MaxObjects -BackupDir $BackupDir
        $result.reach = $reach
        $result.ok = ($reach.failed -eq 0)
        if ($Mode -eq 'reach') {
            $result.readiness = 'scanned'
        } else {
            $result.readiness = if ($reach.failed -eq 0) { 'repaired' } else { 'partially-repaired' }
        }
        Emit-Result $result
        exit 0
    }

    if ($Mode -eq 'trust_check' -or $Mode -eq 'trust_grant' -or $Mode -eq 'trust_revoke') {
        if ([string]::IsNullOrEmpty($Source)) {
            $result.ok = $false
            $result.readiness = 'error'
            $result.error = [ordered]@{
                code    = 'missing-source'
                message = 'trust modes need -Source: the workspace whose sandbox grant is extended'
            }
            Emit-Result $result
            exit 0
        }
        $sourcePath = $Source
        try { $sourcePath = [System.IO.Path]::GetFullPath($Source) } catch { }
        if (-not (Test-Path -LiteralPath $sourcePath)) {
            $result.ok = $false
            $result.readiness = 'error'
            $result.error = [ordered]@{
                code    = 'missing-source'
                message = "the source workspace does not exist: $sourcePath"
            }
            Emit-Result $result
            exit 0
        }

        $script:AclStep = 'trust'
        $trust = Invoke-Trust -Target $targetPath -Source $sourcePath -Mode $Mode `
            -UserSid $userSid -GroupSids $groupSids -BackupDir $BackupDir
        $result.trust = $trust
        $result.ok = ($null -eq $trust.error)
        if ($Mode -eq 'trust_revoke') {
            $result.ok = $result.ok -and [bool]$trust.verified
            $result.readiness = if ($trust.verified) { 'revoked' } else { 'revoke-failed' }
        } elseif ($Mode -eq 'trust_check') {
            $result.readiness = if ($trust.granted) { 'granted' } else { 'not-granted' }
        } else {
            $result.ok = $result.ok -and [bool]$trust.granted
            $result.readiness = if ($trust.granted) { 'granted' } else { 'not-granted' }
        }
        if ($null -ne $trust.error) { $result.error = $trust.error }
        Emit-Result $result
        exit 0
    }

    $acl = Get-Acl -LiteralPath $targetPath
    $ownerSid = Get-OwnerSidText $acl.Owner
    $result.owner = $ownerSid
    $result.ownerName = $acl.Owner
    $result.isOwner = ($ownerSid -eq $userSid)
    $result.accessRulesProtected = [bool]$acl.AreAccessRulesProtected
    $result.sddl = $acl.Sddl
    $result.nullDacl = ($acl.Sddl -match 'D:NO_ACCESS_CONTROL')

    # An owner is implicitly granted READ_CONTROL and WRITE_DAC, so the DACL
    # does not have to carry those bits for the grant to succeed.
    $result.writeDacAce = Test-Granted $acl $userSid $groupSids $PERMISSIONS_MASK
    $result.writeDac = $result.isOwner -or $result.writeDacAce
    $result.writeOwner = Test-Granted $acl $userSid $groupSids $OWNERSHIP_MASK

    $denies = @()
    foreach ($rule in $acl.Access) {
        if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Deny) { continue }
        $sid = Get-SidText $rule.IdentityReference
        if ($null -eq $sid) { continue }
        if ($sid -ne $userSid -and ($groupSids -notcontains $sid)) { continue }
        $rights = [int]$rule.FileSystemRights
        if ((($rights -band $PERMISSIONS_MASK) -eq $PERMISSIONS_MASK) -or (($rights -band $OWNERSHIP_MASK) -eq $OWNERSHIP_MASK) -or (($rights -band $GENERIC_ALL) -ne 0)) {
            $denies += [ordered]@{ sid = $sid; rights = $rule.FileSystemRights.ToString() }
        }
    }
    $result.denies = $denies
    $result.ancestors = Get-AncestorTrace $targetPath $userSid $groupSids $AncestorDepth
    $result.readiness = Get-Readiness $result.isOwner $result.writeDac $result.writeOwner $result.nullDacl
    $result.ok = $true

    if ($Mode -eq 'prepare' -and $result.readiness -eq 'needs-grant') {
        $script:AclStep = 'backup'
        $added = New-UserFullControlRule $userSid
        $daclBefore = $acl.GetSecurityDescriptorSddlForm($ACCESS_SECTIONS)
        $result.backup = Write-Backup -TargetPath $targetPath -UserSid $userSid -Owner $ownerSid -Sddl $acl.Sddl -DaclSddl $daclBefore -BackupDir $BackupDir

        $script:AclStep = 'grant'
        $daclAfter = New-DaclSddl -DaclSddl $daclBefore -Add $added
        Write-DaclSddl -TargetPath $targetPath -DaclSddl $daclAfter
        $result.changed = $true

        $script:AclStep = 'verify'
        $after = Get-Acl -LiteralPath $targetPath
        $result.writeDacAce = Test-Granted $after $userSid $groupSids $PERMISSIONS_MASK
        $result.writeDac = $result.isOwner -or $result.writeDacAce
        $result.writeOwner = Test-Granted $after $userSid $groupSids $OWNERSHIP_MASK
        $result.verified = ($result.writeDac -and $result.writeOwner)
        $result.readiness = Get-Readiness $result.isOwner $result.writeDac $result.writeOwner $false

        if (-not $result.verified) {
            $script:AclStep = 'rollback'
            Write-DaclSddl -TargetPath $targetPath -DaclSddl $daclBefore
            $result.changed = $false
            $result.restored = $true
            $result.readiness = 'blocked'
            $result.ok = $false
            $result.error = [ordered]@{
                code    = 'repair-not-effective'
                message = 'The added allow ACE did not become effective; a deny ACE or a protected ACL blocks it. The change was removed.'
            }
        }
    }

    if ($Mode -eq 'prepare' -and $result.readiness -eq 'blocked') {
        $result.ok = $false
        $result.error = [ordered]@{
            code    = 'not-repairable'
            message = 'The signed-in user is not the owner and holds no WRITE_DAC on this directory, so its permissions cannot be repaired without taking ownership or elevating.'
        }
    }
}
catch {
    $result.ok = $false
    $result.readiness = 'error'
    $result.error = [ordered]@{
        code    = 'inspection-failed'
        message = $_.Exception.Message
        type    = $_.Exception.GetType().FullName
        step    = $script:AclStep
    }
}

Emit-Result $result
exit 0
