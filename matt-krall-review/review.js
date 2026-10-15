(() => {
  'use strict';
  const config = window.MATT_REVIEW_SETTINGS || {};
  const preview = location.protocol === 'file:';
  const posts = [...document.querySelectorAll('[data-review-item]')];
  const controls = new Map();
  const approvals = new Map();
  let comments = [];
  let ready = preview;
  let loading = false;
  const key = 'matt-krall-review-preview-v1';
  const notice = document.querySelector('#review-notice');

  if (preview) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || '{}');
      Object.entries(saved.approvals || {}).forEach(([id, row]) => approvals.set(id, row));
      comments = saved.comments || [];
    } catch (_) {}
  }

  const savePreview = () => {
    if (!preview) return;
    sessionStorage.setItem(key, JSON.stringify({ approvals: Object.fromEntries(approvals), comments }));
  };
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  const request = async (url, body) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(url, {
        cache: 'no-store', signal: abort.signal,
        ...(body ? { method: 'POST', body: new URLSearchParams(body) } : {})
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Request failed');
      return data;
    } finally { clearTimeout(timer); }
  };
  function paint(id) {
    const c = controls.get(id);
    const row = approvals.get(id);
    if (c.busy) return;
    const approved = row?.approved === true;
    c.input.checked = approved;
    c.input.disabled = !ready;
    c.host.classList.toggle('approved', approved);
    c.badge.textContent = approved ? (preview ? 'Preview approved' : 'Approved') : 'Pending approval';
    c.status.textContent = preview ? 'Preview only · not shared' : row ? `${approved ? 'Approved' : 'Reopened'} · ${new Date(row.updatedAt).toLocaleString()}` : ready ? 'Awaiting approval' : 'Shared connection pending';
    c.send.disabled = !ready;
  }
  function drawComments() {
    for (const [id, c] of controls) {
      c.list.replaceChildren();
      const rows = comments.filter(row => row.post === id);
      if (!rows.length) c.list.append(el('p', 'muted', 'No comments yet.'));
      rows.forEach(row => {
        const item = el('article', 'comment-item');
        item.append(el('time', '', new Date(row.createdAt).toLocaleString()), el('p', '', row.message));
        c.list.append(item);
      });
    }
  }
  async function refresh() {
    if (loading) return;
    if (preview) {
      notice.textContent = 'Local preview: approvals and comments work for layout testing only and are not shared.';
      drawComments();
      controls.forEach((_, id) => paint(id));
      return;
    }
    if (!config.approvalsEndpoint || !config.commentsEndpoint) {
      notice.textContent = 'Shared approvals and comments are awaiting connection.';
      return;
    }
    loading = true;
    try {
      const [a, b] = await Promise.all([request(config.approvalsEndpoint), request(config.commentsEndpoint)]);
      if (!a.approvals || !Array.isArray(b.comments)) throw Error('Invalid response');
      Object.values(a.approvals).forEach(row => {
        if (controls.has(row.post)) {
          const old = approvals.get(row.post);
          if (!old || Number(row.id) >= Number(old.id)) approvals.set(row.post, row);
        }
      });
      comments = b.comments.filter(row => controls.has(row.post));
      ready = true;
      controls.forEach((_, id) => paint(id));
      drawComments();
      notice.textContent = 'Approvals and comments are shared across browsers and refresh automatically.';
    } catch (_) {
      notice.textContent = 'Shared feedback could not refresh. Try again; unsent text remains in place.';
    } finally { loading = false; }
  }

  posts.forEach(host => {
    const id = host.dataset.reviewItem;
    const input = host.querySelector('.approval input');
    const status = host.querySelector('.review-status');
    const badge = host.querySelector('.status-badge');
    const list = host.querySelector('.comment-list');
    const form = host.querySelector('.comment-form');
    const message = form.querySelector('textarea');
    const send = form.querySelector('[type="submit"]');
    const feedback = form.querySelector('.comment-status');
    const c = { host, input, status, badge, list, send, busy: false };
    controls.set(id, c);
    input.onchange = async () => {
      const approved = input.checked;
      c.busy = true;
      input.disabled = true;
      status.textContent = 'Saving…';
      try {
        const row = preview ? { id: Date.now(), post: id, approved, updatedAt: new Date().toISOString() } :
          (await request(config.approvalsEndpoint, { post: id, approved: String(approved), requestId: crypto.randomUUID() })).approval;
        if (!row || row.post !== id || row.approved !== approved) throw Error('Not confirmed');
        approvals.set(id, row);
        savePreview();
      } catch (_) { status.textContent = 'Approval was not saved. Refresh and try again.'; }
      finally { c.busy = false; paint(id); }
    };
    let requestId = null;
    let lastText = '';
    form.onsubmit = async event => {
      event.preventDefault();
      if (!ready || !form.reportValidity()) return;
      const text = message.value.trim();
      if (!text || text.length > 2000) return;
      if (text !== lastText || !requestId) { lastText = text; requestId = crypto.randomUUID(); }
      send.disabled = true;
      feedback.textContent = 'Saving…';
      try {
        const row = preview ? { id: requestId, post: id, message: text, createdAt: new Date().toISOString() } :
          (await request(config.commentsEndpoint, { post: id, message: text, requestId, website: form.website.value })).comment;
        if (!row || row.post !== id) throw Error('Not confirmed');
        if (!comments.some(x => x.id === row.id)) comments.push(row);
        savePreview();
        drawComments();
        message.value = '';
        requestId = null;
        feedback.textContent = preview ? 'Preview comment added · not shared.' : 'Comment saved and shared.';
      } catch (_) { feedback.textContent = 'Could not save. Your comment is still here; please try again.'; }
      finally { send.disabled = !ready; }
    };
    host.querySelector('.refresh-comments').onclick = refresh;
    paint(id);
  });

  document.querySelectorAll('.platform-tab').forEach(button => button.onclick = () => {
    const card = button.closest('[data-review-item]');
    const caption = card.querySelector('.caption');
    const label = card.querySelector('.caption-label');
    card.querySelectorAll('.platform-tab').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
    caption.textContent = button.dataset.caption;
    label.textContent = `${button.textContent} · Draft caption for review`;
  });
  document.querySelectorAll('.copy-caption').forEach(button => button.onclick = async () => {
    const box = button.closest('.caption-box');
    const text = box.querySelector('.caption').textContent;
    try { await navigator.clipboard.writeText(text); box.querySelector('.copy-status').textContent = 'Caption copied.'; }
    catch (_) { const range = document.createRange(); range.selectNodeContents(box.querySelector('.caption')); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); box.querySelector('.copy-status').textContent = 'Caption selected. Copy with your keyboard.'; }
  });
  document.querySelector('#review-refresh').onclick = refresh;
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, config.refreshMs || 10000);
})();
