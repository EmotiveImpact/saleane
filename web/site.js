/* global document */
// Two small switches: which app screen to show, and which country's prices to show.

function pick(group, button) {
  for (const other of group.querySelectorAll('button')) {
    other.setAttribute('aria-pressed', String(other === button))
  }
}

const app = document.querySelector('.app')
const screens = document.querySelector('.preview .seg')
screens?.addEventListener('click', (event) => {
  const button = event.target.closest('button')
  if (!button || !app) return
  pick(screens, button)
  app.dataset.view = button.dataset.view
})

const region = document.querySelector('.region')
region?.addEventListener('click', (event) => {
  const button = event.target.closest('button')
  if (!button) return
  pick(region, button)
  const key = button.dataset.region
  for (const el of document.querySelectorAll('[data-uk]')) {
    el.textContent = el.dataset[key]
  }
})
