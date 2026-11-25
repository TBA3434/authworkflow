// Page layout and styling for the gate. Pure HTML, no external assets, so it works behind the CSP-free Render host.

const STEPS = ['Agreement', 'Personal info', 'User IDs', 'Payment'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const CSS = `
  :root { --red: #c8102e; --navy: #14213d; --ink: #1f2933; --muted: #6b7280;
          --line: #e5e7eb; --bg: #f4f6f9; --ok: #15803d; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
         color: var(--ink); background: var(--bg); }
  header { background: var(--navy); color: #fff; padding: 14px 24px; display: flex;
           align-items: center; justify-content: space-between; }
  .brand { font-weight: 700; letter-spacing: .08em; }
  .brand span { color: #ff6b7f; }
  .who { font-size: 13px; opacity: .85; }
  main { max-width: 720px; margin: 32px auto; padding: 0 16px; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: 12px;
          padding: 28px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
  h1 { font-size: 22px; margin: 0 0 6px; }
  h2 { font-size: 16px; margin: 22px 0 8px; }
  p { line-height: 1.55; margin: 8px 0; }
  .muted { color: var(--muted); font-size: 14px; }
  .steps { list-style: none; display: flex; padding: 0; margin: 0 0 24px; gap: 8px; }
  .steps li { flex: 1; font-size: 13px; color: var(--muted); display: flex; align-items: center;
              gap: 8px; padding-top: 10px; border-top: 3px solid var(--line); }
  .steps li span { width: 22px; height: 22px; border-radius: 50%; display: inline-flex;
                   align-items: center; justify-content: center; font-size: 12px;
                   background: var(--line); color: var(--ink); flex: none; }
  .steps li.current { color: var(--ink); font-weight: 600; border-top-color: var(--red); }
  .steps li.current span { background: var(--red); color: #fff; }
  .steps li.done { border-top-color: var(--ok); }
  .steps li.done span { background: var(--ok); color: #fff; }
  .terms { height: 220px; overflow: auto; border: 1px solid var(--line); border-radius: 8px;
           padding: 16px; font-size: 14px; background: #fafafa; margin: 16px 0; }
  .actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; flex-wrap: wrap; }
  .btn { font: inherit; font-size: 15px; padding: 11px 20px; border-radius: 8px;
         border: 1px solid transparent; cursor: pointer; }
  .btn.primary { background: var(--red); color: #fff; }
  .btn.primary:hover { background: #a80d26; }
  .btn.ghost { background: #fff; color: var(--ink); border-color: var(--line); }
  .btn.ghost:hover { background: #f9fafb; }
  label.field { display: block; font-size: 13px; color: var(--muted); margin: 14px 0 4px; }
  input[type=text], input[type=email], input[type=tel] { width: 100%; padding: 10px 12px;
        border: 1px solid var(--line); border-radius: 8px; font: inherit; background: #f9fafb; }
  .radio { display: flex; gap: 18px; margin-top: 6px; font-size: 15px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .notice { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; padding: 12px 14px;
            border-radius: 8px; font-size: 14px; margin-top: 18px; }
  .amount { font-size: 34px; font-weight: 700; margin: 12px 0 4px; }
  .center { text-align: center; padding: 48px 28px; }
  .center h1 { font-size: 24px; }
  footer { text-align: center; color: var(--muted); font-size: 12px; margin: 28px 0; }
`;

function renderPage({ title, body, step = null, email = null }) {
  const progress = step
    ? `<ol class="steps">${STEPS.map((name, i) => {
        const n = i + 1;
        const cls = n < step ? 'done' : n === step ? 'current' : '';
        const mark = n < step ? '&#10003;' : n;
        return `<li class="${cls}"><span>${mark}</span>${esc(name)}</li>`;
      }).join('')}</ol>`
    : '';
  const who = email ? `<div class="who">Signed in as ${esc(email)}</div>` : '';
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Primerica</title>
<style>${CSS}</style>
<header><div class="brand">PRIMERICA <span>&bull;</span> Workvivo</div>${who}</header>
<main>${progress}<div class="card">${body}</div>
<footer>Access check for Primerica Online. Demo environment.</footer></main>`;
}

module.exports = { renderPage, esc, STEPS };
