// Briefly's page: sends the form, shows progress as the brief is made, and draws the sheet.
// Everything from the brief is put on the page as text, never as HTML.

(() => {
  const $ = (id) => document.getElementById(id);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const STEPS = [
    ['pin', 'Work out who they are'],
    ['plan', 'Plan the searches'],
    ['search', 'Search the last 30 days'],
    ['group', 'Group headlines into events'],
    ['read', 'Read the pages'],
    ['draft', 'Draft from the pages'],
    ['verify', 'Check every claim against its source'],
    ['compose', 'Write the summary and questions'],
  ];
  let current = null;
  let busy = false;
  let canRunLive = true;

  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) node.append(kid);
    return node;
  }

  function day(d, withYear) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
    if (!m) return d || '';
    return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${withYear ? ' ' + m[1] : ''}`;
  }

  function localToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function daysApart(from, to) {
    return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
  }

  // ---- The sheet ---------------------------------------------------------------------------

  function proofFor(brief, claims, sourceId) {
    const source = brief.sources.find((s) => s.id === sourceId);
    const box = el('div', { class: 'proof' });
    if (!source) return box;
    box.append(el('p', { class: 'from', text: `From ${source.domain}, ${day(source.date, true)}${source.textFrom === 'snippet' ? ' (search snippet only; the page could not be read)' : ''}` }));
    const seen = new Set();
    for (const c of claims) {
      for (const e of c.evidence) {
        if (e.sourceId !== sourceId || seen.has(e.passage)) continue;
        seen.add(e.passage);
        box.append(el('p', {}, el('q', { text: e.passage })));
      }
    }
    box.append(el('p', { class: 'from' }, el('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open the page' })));
    return box;
  }

  /** The numbered source marks after a line. Clicking one shows the passage the line rests on. */
  function cites(brief, li, claims) {
    const ids = [];
    for (const c of claims) for (const e of c.evidence) if (!ids.includes(e.sourceId)) ids.push(e.sourceId);
    return ids.map((id) => {
      const source = brief.sources.find((s) => s.id === id);
      const b = el('button', {
        type: 'button',
        class: 'cite',
        'aria-expanded': 'false',
        'aria-label': `Source ${id}${source ? ': ' + source.domain : ''}. Show the passage.`,
        text: id,
      });
      b.addEventListener('click', () => {
        const open = li.querySelector('.proof');
        const was = b.getAttribute('aria-expanded') === 'true';
        if (open) open.remove();
        for (const other of li.querySelectorAll('.cite')) other.setAttribute('aria-expanded', 'false');
        if (!was) {
          li.append(proofFor(brief, claims, id));
          b.setAttribute('aria-expanded', 'true');
        }
      });
      return b;
    });
  }

  function claimItem(brief, c, dated) {
    const li = el('li');
    const body = el('span', { text: c.text });
    if (dated) {
      li.append(el('time', { datetime: c.date || '', text: c.date ? day(c.date) : '' }), el('div', {}, body, cites(brief, li, [c])));
    } else {
      li.append(body, ...cites(brief, li, [c]));
    }
    return li;
  }

  function lineItem(brief, line, byId) {
    const li = el('li');
    const claims = line.refs.map((r) => byId.get(r)).filter(Boolean);
    li.append(el('span', { text: line.text }), ...cites(brief, li, claims));
    return li;
  }

  function heading(text, aside, checked) {
    return el('h3', { class: checked ? 'checked' : null }, text, aside ? el('span', { text: aside }) : null);
  }

  function meetingText(brief) {
    const meeting = (brief.request.meetingAt || '').slice(0, 10);
    const gap = daysApart(brief.generatedAt.slice(0, 10), meeting);
    const when = gap === 0 ? 'today' : gap === 1 ? 'tomorrow' : gap > 1 ? `in ${gap} days` : `${-gap} day${gap === -1 ? '' : 's'} ago`;
    return `${day(meeting, true)} (${when})`;
  }

  function drawBrief(brief) {
    current = brief;
    const sheet = $('sheet');
    sheet.className = 'sheet';
    sheet.replaceChildren();
    const reported = brief.reported || [];
    const byId = new Map([...brief.developments, ...brief.people, ...reported].map((c) => [c.id, c]));
    const nChecked = brief.developments.length + brief.people.length;

    sheet.append(
      el('p', { class: 'kicker', text: 'Briefing' }),
      el('h2', { class: 'who', text: brief.entity.name }),
      el(
        'p',
        { class: 'facts' },
        el('span', {}, el('b', { text: 'Meeting ' }), meetingText(brief)),
        el('span', {}, el('b', { text: 'Covers ' }), `${day(brief.window.start)} to ${day(brief.window.end, true)}`),
        brief.request.purpose ? el('span', {}, el('b', { text: 'For ' }), brief.request.purpose) : null,
      ),
    );
    if (brief.entity.summary) sheet.append(el('p', { class: 'about', text: brief.entity.summary }));
    if (brief.entity.ambiguity) sheet.append(el('p', { class: 'note', text: `Check this is the right ${brief.entity.kind}: ${brief.entity.ambiguity}` }));

    if (brief.quiet) {
      sheet.append(
        heading('At a glance'),
        el('p', { class: 'quiet-note', text: `No verified news about ${brief.entity.name} was found in these 30 days. Nothing has been added to fill the page.` }),
      );
    } else if (brief.glance.length) {
      sheet.append(heading('At a glance'), el('ul', { class: 'glance' }, brief.glance.map((l) => lineItem(brief, l, byId))));
    }
    if (brief.developments.length) {
      sheet.append(
        heading('Key developments', 'each checked against its source', true),
        el('ul', { class: 'dated' }, brief.developments.map((c) => claimItem(brief, c, true))),
      );
    }
    if (brief.people.length) sheet.append(heading('People'), el('ul', { class: 'dated' }, brief.people.map((c) => claimItem(brief, c, true))));
    if (reported.length) {
      sheet.append(
        el(
          'section',
          { class: 'reported' },
          el('h3', { text: 'Reported, not confirmed' }),
          el('p', { class: 'why-all', text: 'The sources themselves present these as unconfirmed. Each was checked to make sure the source says what is written here.' }),
          el('ul', { class: 'dated' }, reported.map((c) => claimItem(brief, c, true))),
        ),
      );
    }
    if (brief.talkingPoints.length) sheet.append(heading('Talking points'), el('ul', { class: 'plain' }, brief.talkingPoints.map((l) => lineItem(brief, l, byId))));
    if (brief.openQuestions.length) sheet.append(heading('Open questions'), el('ul', { class: 'plain' }, brief.openQuestions.map((q) => el('li', { text: q }))));

    if (brief.unverified.length) {
      const list = el('ul');
      for (const c of brief.unverified) {
        const li = claimItem(brief, c, false);
        li.append(el('span', { class: 'why', text: `Held back: ${c.reason || 'no reason recorded'}` }));
        list.append(li);
      }
      sheet.append(
        el(
          'section',
          { class: 'held' },
          el('h3', { text: 'Not verified' }),
          el('p', { class: 'why-all', text: 'Drafted from the sources, then held back because a check failed. Treat these as leads, not facts.' }),
          list,
        ),
      );
    }

    if (brief.sources.length) {
      sheet.append(
        heading('Sources'),
        el(
          'ol',
          { class: 'sources' },
          brief.sources.map((s) =>
            el(
              'li',
              {},
              el('b', { text: s.id }),
              el('div', {}, el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title || s.domain }), el('span', { text: ` ${s.domain}, ${day(s.date, true)}` })),
            ),
          ),
        ),
      );
    }
    const u = brief.usage;
    sheet.append(
      el('p', {
        class: 'foot',
        text: `Written by Briefly on ${day(brief.generatedAt.slice(0, 10), true)} with ${brief.researchedWith || 'Tavily'} and ${brief.model}. ${u.searches} searches, ${u.pagesRead} pages read, ${nChecked} fact${nChecked === 1 ? '' : 's'} verified, ${reported.length} unconfirmed report${reported.length === 1 ? '' : 's'}, ${brief.unverified.length} held back.`,
      }),
    );

    // How it was made
    const how = $('how-body');
    how.replaceChildren(
      el(
        'table',
        {},
        el('tbody', {}, brief.trace.map((t) => el('tr', {}, el('th', { text: (STEPS.find((s) => s[0] === t.step) || [0, t.step])[1] }), el('td', { class: 't', text: `${(t.ms / 1000).toFixed(1)} s` }), el('td', { text: t.detail })))),
      ),
      el('p', {
        class: 'totals',
        text: `${u.searches} searches and ${u.pagesRead} pages read (${u.tavilyCredits} Tavily credits). ${u.llmCalls} model calls: ${u.llmTokensIn.toLocaleString()} tokens in, ${u.llmTokensOut.toLocaleString()} out. ${brief.words} words on the page.`,
      }),
    );
    $('how').hidden = false;
    $('tools').hidden = false;
    document.title = `Briefing: ${brief.entity.name}`;
  }

  // ---- Progress ----------------------------------------------------------------------------

  function resetSteps() {
    const list = $('steps');
    list.replaceChildren(...STEPS.map(([id, label]) => el('li', { 'data-step': id }, el('div', {}, el('span', { text: label })))));
    list.hidden = false;
  }

  function onProgress(p) {
    const list = $('steps');
    if (p.type === 'step') {
      for (const li of list.children) if (li.classList.contains('doing')) li.className = 'done';
      const li = list.querySelector(`[data-step="${p.step}"]`);
      if (li) li.className = 'doing';
    } else if (p.type === 'detail') {
      const li = list.querySelector(`[data-step="${p.step}"]`);
      if (li) {
        li.className = 'done';
        li.firstChild.append(el('small', { text: p.detail.length > 190 ? p.detail.slice(0, 190) + ' …' : p.detail }));
      }
    } else if (p.type === 'done') {
      for (const li of list.children) li.className = 'done';
      drawBrief(p.brief);
    } else if (p.type === 'error') {
      const li = list.querySelector('.doing');
      if (li) li.className = 'failed';
      showError(p.message);
    }
  }

  function showError(message) {
    const e = $('form-error');
    e.textContent = message;
    e.hidden = !message;
  }

  async function run(path, body) {
    if (busy) return;
    busy = true;
    showError('');
    $('go').disabled = true;
    $('example').disabled = true;
    resetSteps();
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        $('steps').hidden = true;
        showError(data.error || 'The brief could not be started. Try again.');
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          if (!chunk.startsWith('data: ')) continue;
          const p = JSON.parse(chunk.slice(6));
          if (p.type === 'done' || p.type === 'error') finished = true;
          onProgress(p);
        }
      }
      if (!finished) showError('The connection dropped before the brief was finished. Try again.');
    } catch {
      showError('The server could not be reached. Check it is running, then try again.');
    } finally {
      busy = false;
      $('go').disabled = !canRunLive;
      $('example').disabled = false;
    }
  }

  async function download(format) {
    if (!current) return;
    const res = await fetch(`/api/export/${format}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(current) });
    if (!res.ok) return;
    const blob = await res.blob();
    const name = (/filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '') || [])[1] || `brief.${format}`;
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---- Start -------------------------------------------------------------------------------

  $('print').addEventListener('click', () => window.print());

  if (window.BRIEF) {
    // A saved page: the brief is already inside it.
    drawBrief(window.BRIEF);
    return;
  }

  $('meetingAt').value = localToday();
  $('save-md').addEventListener('click', () => download('md'));
  $('save-html').addEventListener('click', () => download('html'));
  $('example').addEventListener('click', () => run('/api/example'));
  $('form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData($('form'));
    const subject = String(f.get('subject') || '').trim();
    if (subject.length < 2) {
      showError('Say who the meeting is with.');
      $('subject').focus();
      return;
    }
    if (!f.get('meetingAt')) {
      showError('Give the meeting date.');
      $('meetingAt').focus();
      return;
    }
    run('/api/brief', {
      subject,
      kind: f.get('kind'),
      meetingAt: f.get('meetingAt'),
      purpose: String(f.get('purpose') || '').trim(),
      hint: String(f.get('hint') || '').trim(),
      code: String(f.get('code') || ''),
      now: localToday(),
    });
  });

  fetch('/api/status')
    .then((r) => r.json())
    .then((s) => {
      $('example').hidden = !s.example;
      $('code-row').hidden = !s.needsCode;
      if (!s.live) {
        canRunLive = false;
        $('go').disabled = true;
        showError(s.example ? 'This server has no API keys set, so it can only show the recorded example.' : 'This server has no API keys set. See .env.example.');
      }
    })
    .catch(() => {});
})();
