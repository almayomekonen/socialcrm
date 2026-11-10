// The customer's quote link (/api/q#<token>). The token stays in the fragment: it is
// sent only in this request's body, never in a URL a server or a Referer would see.
const status = document.getElementById('status')
const token = location.hash.slice(1)
history.replaceState(null, '', location.pathname)
const fail = () => {
  if (status) status.textContent = status.dataset.failed || ''
}
if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail()
else
  fetch('/api/q', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), credentials: 'omit', referrerPolicy: 'no-referrer' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && d.url ? location.replace(d.url) : fail()))
    .catch(fail)
