const form = document.querySelector('#chat-form');
const input = document.querySelector('#question');
const messages = document.querySelector('#messages');
const sendButton = document.querySelector('#send');
const toast = document.querySelector('#toast');
const fileIntro = document.querySelector('#file-intro');
const letterBackdrop = document.querySelector('#letter-backdrop');
const corpusBackdrop = document.querySelector('#corpus-backdrop');
let previousResponseId;
let lastQuestion = '';
let toastTimer;

function finishIntro() {
  if (!fileIntro || fileIntro.classList.contains('done')) return;
  fileIntro.classList.add('done');
}
document.querySelector('#skip-intro').addEventListener('click', finishIntro);
fileIntro.addEventListener('animationend', (event) => {
  if (event.animationName === 'intro-exit') finishIntro();
});
setTimeout(finishIntro, 3600);

const letterDate = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'long', timeZone: 'America/Monterrey'
}).format(new Date());
document.querySelector('#letter-date').textContent = letterDate;
const openLetter = document.querySelector('#open-letter');
const closeLetter = document.querySelector('#close-letter');
function showLetter() {
  letterBackdrop.hidden = false;
  document.body.classList.add('dialog-open');
  closeLetter.focus();
}
function hideLetter() {
  letterBackdrop.hidden = true;
  document.body.classList.remove('dialog-open');
  openLetter.focus();
}
openLetter.addEventListener('click', showLetter);
closeLetter.addEventListener('click', hideLetter);
letterBackdrop.addEventListener('click', (event) => {
  if (event.target === letterBackdrop) hideLetter();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !letterBackdrop.hidden) hideLetter();
  if (event.key === 'Escape' && !corpusBackdrop.hidden) hideCorpus();
});
document.querySelector('#print-letter').addEventListener('click', () => window.print());

const corpusButton = document.querySelector('#corpus-info');
const corpusClose = document.querySelector('#close-corpus');
function showCorpus() {
  corpusBackdrop.hidden = false;
  document.body.classList.add('dialog-open');
  corpusClose.focus();
}
function hideCorpus() {
  corpusBackdrop.hidden = true;
  document.body.classList.remove('dialog-open');
  corpusButton.focus();
}
corpusButton.addEventListener('click', showCorpus);
corpusClose.addEventListener('click', hideCorpus);
corpusBackdrop.addEventListener('click', (event) => {
  if (event.target === corpusBackdrop) hideCorpus();
});

const exampleQuestions = [
  '¿Qué medidas de seguridad exige la LFPDPPP?',
  '¿Cuándo debe notificarse una vulneración de datos personales?',
  '¿Qué diferencia hay entre los artículos 211 bis 2 y 211 bis 3 del CPF?',
  '¿En qué casos pueden conservarse datos personales después de solicitar su cancelación?',
  '¿Qué obligaciones de protección de datos aplican a los sujetos obligados?',
  '¿Qué pasos técnicos recomienda el material para coordinar la respuesta a un incidente?',
  '¿Qué criterios judiciales del acervo hablan sobre evidencia digital?',
  '¿Qué normas del acervo regulan telecomunicaciones y seguridad de la información?',
  '¿Qué obligaciones pueden aplicar a una institución de tecnología financiera ante un incidente?',
  '¿Qué aspectos procesales debo considerar para preservar evidencia de un sistema?',
  '¿Qué diferencias existen entre la ley para particulares y la de sujetos obligados en datos personales?',
  '¿Qué documentos del acervo tratan sobre infraestructura crítica y coordinación de incidentes?'
];
let exampleOffset = 0;
try {
  exampleOffset = Number(sessionStorage.getItem('lex-example-offset') || 0) % exampleQuestions.length;
  sessionStorage.setItem('lex-example-offset', String((exampleOffset + 4) % exampleQuestions.length));
} catch { /* Si el almacenamiento está deshabilitado, se muestran los primeros ejemplos. */ }
const suggestions = document.querySelector('#suggestions');
for (let index = 0; index < 4; index += 1) {
  const question = exampleQuestions[(exampleOffset + index) % exampleQuestions.length];
  const button = document.createElement('button');
  button.className = 'suggestion'; button.type = 'button'; button.textContent = question;
  button.addEventListener('click', () => { input.value = question; submitQuestion(question); });
  suggestions.append(button);
}

// Build a small, safe Markdown subset with DOM nodes (never inject model HTML).
function inlineMarkdown(text, parent) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(document.createTextNode(text.slice(cursor, match.index)));
    const token = match[0];
    let node;
    if (token.startsWith('`')) {
      node = document.createElement('code'); node.textContent = token.slice(1, -1);
    } else if (token.startsWith('**')) {
      node = document.createElement('strong'); node.textContent = token.slice(2, -2);
    } else if (token.startsWith('*')) {
      node = document.createElement('em'); node.textContent = token.slice(1, -1);
    } else {
      const parts = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      try {
        const url = new URL(parts[2]);
        if (url.protocol === 'https:' || url.protocol === 'http:') {
          node = document.createElement('a'); node.textContent = parts[1]; node.href = url.href;
          node.target = '_blank'; node.rel = 'noopener noreferrer';
        }
      } catch { /* invalid URL stays plain text */ }
      if (!node) node = document.createTextNode(token);
    }
    parent.append(node); cursor = match.index + token.length;
  }
  parent.append(document.createTextNode(text.slice(cursor)));
}

function renderMarkdown(text, container) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  let list;
  for (const line of lines) {
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol';
      if (!list || list.tagName.toLowerCase() !== type) { list = document.createElement(type); container.append(list); }
      const item = document.createElement('li'); inlineMarkdown((bullet || numbered)[1], item); list.append(item); continue;
    }
    list = null;
    if (!line.trim()) continue;
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    const block = document.createElement(heading ? `h${heading[1].length + 2}` : quote ? 'blockquote' : 'p');
    inlineMarkdown(heading?.[2] || quote?.[1] || line, block); container.append(block);
  }
}

function showToast(message) {
  toast.textContent = message; toast.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 1800);
}

function addMessage(text, role, sources = [], { pending = false } = {}) {
  document.querySelector('#welcome')?.remove();
  const article = document.createElement('article');
  article.className = `message ${role}${pending ? ' pending' : ''}`;
  const body = document.createElement('div'); body.className = 'message-body';
  if (role === 'assistant' && !pending) renderMarkdown(text, body);
  else body.textContent = text;
  article.append(body);
  if (sources.length) {
    const details = document.createElement('details'); details.className = 'sources-details';
    const summary = document.createElement('summary'); summary.textContent = `Fuentes recuperadas (${sources.length})`;
    const list = document.createElement('ul'); list.className = 'sources';
    for (const source of sources) { const item = document.createElement('li'); item.textContent = source; list.append(item); }
    details.append(summary, list); article.append(details);
  }
  if (role === 'assistant' && !pending) {
    const actions = document.createElement('div'); actions.className = 'message-actions';
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'icon-button'; copy.textContent = 'Copiar'; copy.setAttribute('aria-label', 'Copiar respuesta');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); showToast('Respuesta copiada'); }
      catch { showToast('No se pudo copiar'); }
    });
    actions.append(copy);
    if (lastQuestion) {
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'icon-button'; retry.textContent = 'Reintentar';
      retry.addEventListener('click', () => submitQuestion(lastQuestion)); actions.append(retry);
    }
    article.append(actions);
  }
  messages.append(article); article.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return article;
}

async function submitQuestion(rawQuestion) {
  const question = rawQuestion.trim();
  if (!question || sendButton.disabled) return;
  lastQuestion = question;
  addMessage(question, 'user'); input.value = '';
  sendButton.disabled = true; sendButton.querySelector('span:first-child').textContent = 'Consultando';
  const pending = addMessage('Buscando en tus documentos…', 'assistant', [], { pending: true });
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, previous_response_id: previousResponseId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al consultar.');
    previousResponseId = data.response_id;
    pending.remove(); addMessage(data.answer, 'assistant', data.sources);
  } catch (error) {
    pending.classList.remove('pending'); pending.querySelector('.message-body').textContent = error.message || 'No se pudo completar la consulta.';
  } finally {
    sendButton.disabled = false; sendButton.querySelector('span:first-child').textContent = 'Enviar'; input.focus();
  }
}

form.addEventListener('submit', (event) => { event.preventDefault(); submitQuestion(input.value); });
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
});
