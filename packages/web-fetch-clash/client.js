// @inlve/dsh-web-fetch-clash browser half: the plugin row's Configure page on
// the Plugins page. Hand-written in the loader's factory format (same shape as
// a built DSH client bundle): plain JS, React.createElement only, no build step.
// It requires only "react", which the Host provides.
window.__ModuleLoader__.load({
  id: '@inlve/dsh-web-fetch-clash',
  factory: (require) => {
    var module = { exports: {} };
    const React = require('react');

    // Served namespaces are loader entry ids: the row's `id` in the bundle
    // patch, not the package name.
    const ENTRY_ID = 'web-fetch-clash';
    const DICT_NS = 'settings.web-fetch-clash';
    const SLOT_KEY = '@inlve/dsh-web-fetch-clash#web-fetch-clash';

    const zh = {
      summary: 'Clash 兜底',
      controller: 'Clash 控制器地址',
      controllerHint: '例如 http://192.168.0.1:9090；http 仅允许回环或私网地址。',
      secret: '控制器密钥（回退）',
      secretHint: '环境变量与凭据引用都不可用时才使用；建议留空。',
      secretEnv: '密钥环境变量名',
      secretEnvHint: '凭据服务不可用时的环境变量回退；Windows 变量名不区分大小写，macOS/Linux 区分。',
      secretRef: '凭据服务引用名',
      secretRefHint: '优先通过 DSH 凭据服务读取（存储文件 > 启动环境 > .env）；未配置时回退到环境变量/密钥字段。',
      resolve: '解析模式',
      resolveHint: 'auto：系统解析优先，Fake-IP 命中时才问 Clash；clash：全部问 Clash。',
      connect: '连接方式',
      connectHint: 'fake：连 Fake-IP，保留域名分流规则；real：连校验过的真实 IP。',
      fakeCidrs: 'Fake-IP 地址池',
      fakeCidrsHint: '与 Clash 的 fake-ip-range / fake-ip-range6 一致，逗号分隔。',
      lanCidrs: '局域网白名单',
      lanCidrsHint: '该网段内的地址直接放行（让 Hosts 里的内网条目可用）；留空关闭。',
      cacheTtlMs: '校验缓存（毫秒）',
      cacheTtlMsHint: 'TTL 内重复抓取不再询问 Clash；0 表示关闭。',
      queryTimeoutMs: '控制器查询超时（毫秒）',
      timeoutMs: '抓取超时（毫秒）',
      maxResponseBytes: '响应上限（字节）',
      maxBodyChars: '正文上限（字符）',
      maxRedirects: '同源重定向上限',
      userAgent: 'User-Agent',
      save: '保存',
      discard: '放弃修改',
      saving: '保存中…',
      unsaved: '有未保存的修改',
      saveFailed: '保存未生效，请检查输入',
      readOnly: '当前配置只读，无法保存',
      invalidNumber: '需要非负整数',
      invalidText: '不能为空',
      invalidChoice: '取值不合法',
    };
    const en = {
      summary: 'Clash fallback',
      controller: 'Clash controller URL',
      controllerHint: 'e.g. http://192.168.0.1:9090; plain http is allowed only for loopback/private hosts.',
      secret: 'Controller secret (fallback)',
      secretHint: 'Used only when neither the credential reference nor the environment variable provides a value; prefer leaving it empty.',
      secretEnv: 'Secret environment variable',
      secretEnvHint: 'Fallback variable when the credential service is unavailable; Windows names are case-insensitive, macOS/Linux are case-sensitive.',
      secretRef: 'Credential reference',
      secretRefHint: 'Read through the DSH credential service first (stored file > launch env > .env); falls back to the variable/field above.',
      resolve: 'Resolution mode',
      resolveHint: 'auto: system first, ask Clash only for Fake-IP; clash: always ask Clash.',
      connect: 'Transport',
      connectHint: 'fake: connect to the Fake-IP (keeps domain rules); real: connect to verified real IPs.',
      fakeCidrs: 'Fake-IP pools',
      fakeCidrsHint: 'Must match fake-ip-range / fake-ip-range6; comma separated.',
      lanCidrs: 'LAN allowlist',
      lanCidrsHint: 'Addresses in these CIDRs are allowed (Hosts LAN entries); empty disables.',
      cacheTtlMs: 'Verification cache (ms)',
      cacheTtlMsHint: 'Repeat fetches skip Clash within the TTL; 0 disables.',
      queryTimeoutMs: 'Controller query timeout (ms)',
      timeoutMs: 'Fetch timeout (ms)',
      maxResponseBytes: 'Response cap (bytes)',
      maxBodyChars: 'Body cap (chars)',
      maxRedirects: 'Same-origin redirect limit',
      userAgent: 'User-Agent',
      save: 'Save',
      discard: 'Discard',
      saving: 'Saving…',
      unsaved: 'Unsaved changes',
      saveFailed: 'Save did not take effect; check the input',
      readOnly: 'This configuration is read-only',
      invalidNumber: 'A non-negative integer is required',
      invalidText: 'Must not be empty',
      invalidChoice: 'Invalid value',
    };

    const inject = ['slots', 'locale', 'configForms'];

    const FIELDS = [
      { key: 'controller', kind: 'text' },
      { key: 'secretRef', kind: 'text' },
      { key: 'secretEnv', kind: 'text' },
      { key: 'secret', kind: 'password' },
      { key: 'resolve', kind: 'select', options: ['auto', 'clash'] },
      { key: 'connect', kind: 'select', options: ['fake', 'real'] },
      { key: 'fakeCidrs', kind: 'text' },
      { key: 'lanCidrs', kind: 'text' },
      { key: 'cacheTtlMs', kind: 'number', min: 0 },
      { key: 'queryTimeoutMs', kind: 'number', min: 1 },
      { key: 'timeoutMs', kind: 'number', min: 1 },
      { key: 'maxResponseBytes', kind: 'number', min: 1 },
      { key: 'maxBodyChars', kind: 'number', min: 1 },
      { key: 'maxRedirects', kind: 'number', min: 0, integer: true },
      { key: 'userAgent', kind: 'text' },
    ];

    const S = {
      body: { borderTop: '0.5px solid var(--dsw-alias-border-l2)', margin: '0 16px', paddingBottom: 8 },
      field: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0' },
      fieldDivided: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0', borderTop: '0.5px solid var(--dsw-alias-border-l2)' },
      label: { fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' },
      input: { height: 34, padding: '0 12px', border: '0.5px solid var(--dsw-alias-border-l4)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)', font: 'inherit', fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)', width: '100%', boxSizing: 'border-box' },
      inputInvalid: { height: 34, padding: '0 12px', border: '0.5px solid var(--dsw-alias-label-error)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)', font: 'inherit', fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)', width: '100%', boxSizing: 'border-box' },
      hint: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
      invalid: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-error)' },
      footer: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 0 4px', borderTop: '0.5px solid var(--dsw-alias-border-l2)' },
      status: { flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
      failed: { flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-error)' },
      discard: { appearance: 'none', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '5px 14px', font: 'inherit', fontSize: 13, lineHeight: 1.5, cursor: 'pointer', background: 'none', color: 'var(--dsw-alias-label-secondary)' },
      save: { appearance: 'none', border: '1px solid transparent', borderRadius: 8, padding: '5px 14px', font: 'inherit', fontSize: 13, lineHeight: 1.5, cursor: 'pointer', background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-3)' },
      disabled: { opacity: 0.4, cursor: 'default' },
    };

    function parseField(spec, text) {
      if (spec.kind === 'number') {
        const trimmed = text.trim();
        if (trimmed === '') return undefined;
        const value = Number(trimmed);
        if (!Number.isFinite(value)) return undefined;
        if (spec.integer && !Number.isInteger(value)) return undefined;
        if (value < (spec.min ?? 0)) return undefined;
        return { kind: 'set', value };
      }
      if (spec.kind === 'select') {
        return spec.options.includes(text) ? { kind: 'set', value: text } : undefined;
      }
      const trimmed = text.trim();
      if (trimmed === '') return { kind: 'unset' };
      if (spec.key === 'controller' && !/^https?:\/\//i.test(trimmed)) return undefined;
      if (spec.key === 'fakeCidrs' && trimmed === '') return undefined;
      return { kind: 'set', value: trimmed };
    }

    function displayValue(snapshot, key) {
      const value = snapshot && snapshot.value ? snapshot.value[key] : undefined;
      return value === undefined || value === null ? '' : String(value);
    }

    function Card(props) {
      const t = props.t || ((key) => key);
      const view = props.view;
      const form = props.form;
      const [staged, setStaged] = React.useState({});
      const [saving, setSaving] = React.useState(false);
      const [failed, setFailed] = React.useState(false);

      const ready = form && form.state && form.state.status === 'ready';
      const snapshot = ready ? form.state : null;

      if (view === 'summary') {
        if (!snapshot) return null;
        const controller = displayValue(snapshot, 'controller');
        const resolve = displayValue(snapshot, 'resolve') || 'auto';
        const connect = displayValue(snapshot, 'connect') || 'fake';
        return React.createElement('span', null, `${controller} · ${resolve}/${connect}`);
      }
      if (!snapshot) return null;

      const disabled = !snapshot.writable;
      const original = (key) => displayValue(snapshot, key);
      const current = (key) => (staged[key] !== undefined ? staged[key] : original(key));

      const setField = (key, text) => {
        const next = { ...staged };
        next[key] = text;
        setFailed(false);
        setStaged(next);
      };

      const edits = FIELDS
        .map((spec) => ({ spec, text: current(spec.key) }))
        .filter(({ spec, text }) => text !== original(spec.key));

      const invalid = edits.some(({ spec, text }) => parseField(spec, text) === undefined);
      const dirty = edits.length > 0;
      const blocked = !dirty || invalid || saving;

      const discard = () => {
        setStaged({});
        setFailed(false);
      };

      const save = () => {
        if (blocked) return;
        const ops = [];
        for (const { spec, text } of edits) {
          const write = parseField(spec, text);
          if (write === undefined) return;
          if (write.kind === 'unset') ops.push({ op: 'unset', path: [spec.key] });
          else ops.push({ op: 'set', path: [spec.key], value: write.value });
        }
        if (ops.length === 0) return;
        setSaving(true);
        setFailed(false);
        Promise.resolve(form.mutate(ops, snapshot.revision)).then(
          (ok) => {
            setSaving(false);
            if (ok) setStaged({});
            else setFailed(true);
          },
          () => {
            setSaving(false);
            setFailed(true);
          },
        );
      };

      const rows = FIELDS.map((spec, index) => {
        const text = current(spec.key);
        const bad = parseField(spec, text) === undefined;
        const label = t(spec.key);
        const hintKey = spec.key + 'Hint';
        const hint = t(hintKey);
        const control = spec.kind === 'select'
          ? React.createElement('select', {
            style: bad ? S.inputInvalid : S.input,
            value: text,
            disabled,
            onChange: (event) => setField(spec.key, event.target.value),
          }, spec.options.map((option) => React.createElement('option', { key: option, value: option }, option)))
          : React.createElement('input', {
            style: bad ? S.inputInvalid : S.input,
            type: spec.kind === 'password' ? 'password' : 'text',
            inputMode: spec.kind === 'number' ? 'numeric' : undefined,
            value: text,
            disabled,
            onChange: (event) => setField(spec.key, event.target.value),
          });
        return React.createElement('div', { key: spec.key, style: index === 0 ? S.field : S.fieldDivided },
          React.createElement('label', { style: S.label }, label),
          control,
          bad ? React.createElement('p', { style: S.invalid }, t('invalidChoice'))
            : hint ? React.createElement('p', { style: S.hint }, hint) : null,
        );
      });

      return React.createElement('div', { style: S.body },
        snapshot.writable ? null : React.createElement('p', { style: S.hint }, t('readOnly')),
        dirty ? React.createElement('p', { style: S.hint }, t('unsaved')) : null,
        ...rows,
        React.createElement('div', { style: S.footer },
          failed ? React.createElement('p', { style: S.failed }, t('saveFailed'))
            : React.createElement('p', { style: S.status }, ''),
          React.createElement('button', {
            type: 'button',
            style: { ...S.discard, ...((!dirty || saving) ? S.disabled : {}) },
            disabled: !dirty || saving,
            onClick: discard,
          }, t('discard')),
          React.createElement('button', {
            type: 'button',
            style: { ...S.save, ...(blocked ? S.disabled : {}) },
            disabled: blocked,
            onClick: save,
          }, saving ? t('saving') : t('save')),
        ),
      );
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(DICT_NS, { zh, en }), 'web-fetch-clash: dictionaries');
      ctx.effect(() => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject(
        'plugins.row.config',
        () => ctx.slots.register({
          name: 'plugins.row.config',
          key: SLOT_KEY,
          locale: DICT_NS,
          inject: () => ({}),
        }, Card),
      )), 'web-fetch-clash: row page');
    }

    module.exports = { inject, apply };
    return module.exports;
  },
});
