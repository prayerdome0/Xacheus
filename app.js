const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
const launchForm = document.querySelector('#launch-form');
const resultPanel = document.querySelector('#result-panel');
const accordionItems = document.querySelectorAll('.accordion-item');

// Theme toggle
const themeToggle = document.getElementById('theme-toggle');
if (themeToggle) {
  const savedTheme = localStorage.getItem('xacheus-theme');
  if (savedTheme === 'light') document.documentElement.classList.add('light');
  themeToggle.textContent = document.documentElement.classList.contains('light') ? '☾' : '☀︎';

  themeToggle.addEventListener('click', () => {
    const isLight = document.documentElement.classList.toggle('light');
    localStorage.setItem('xacheus-theme', isLight ? 'light' : 'dark');
    themeToggle.textContent = isLight ? '☾' : '☀︎';
  });
}

navToggle?.addEventListener('click', () => {
  const isOpen = navLinks.classList.toggle('open');
  document.body.classList.toggle('nav-open', isOpen);
  navToggle.setAttribute('aria-expanded', String(isOpen));
});

navLinks?.addEventListener('click', (event) => {
  if (event.target.tagName === 'A') {
    navLinks.classList.remove('open');
    document.body.classList.remove('nav-open');
    navToggle.setAttribute('aria-expanded', 'false');
  }
});

accordionItems.forEach((item) => {
  item.addEventListener('click', () => {
    accordionItems.forEach((other) => other.classList.remove('active'));
    item.classList.add('active');
  });
});

const regionalRecommendations = {
  Zambia: ['WhatsApp admin confirmation: +260 973 028 342', 'Mobile money readiness', 'Local SEO for Zambian customers'],
  'Southern Africa': ['Zambia, Zimbabwe, Botswana, Eswatini, South Africa, Mozambique, Malawi, and Namibia targeting', 'WhatsApp-first sales flow', 'Regional shipping and service areas'],
  Africa: ['Africa-first positioning', 'Mobile money and bank-payment roadmap', 'English plus future African-language support'],
  Worldwide: ['Geo currency switcher roadmap', 'International shipping rules', 'Global SEO keyword clusters'],
  Europe: ['VAT-aware checkout settings', 'GDPR-friendly consent flow', 'Multilingual SEO collections'],
  'North America': ['Fast-shipping promise blocks', 'Email/SMS cart recovery', 'Google Shopping product feed'],
  'Asia-Pacific': ['Marketplace-ready catalog feeds', 'Local delivery zones', 'English plus regional landing pages'],
};

const modelPlaybooks = {
  'Online store': ['Create starter products and collections', 'Add cart, checkout, discounts, and order tracking', 'Add abandoned-cart and WhatsApp follow-up ideas'],
  Services: ['Publish packages and booking CTA', 'Add testimonials, case studies, and FAQs', 'Automate lead qualification with AI assistant'],
  'Restaurant / food': ['Add menu and delivery zones', 'Feature best-selling meals', 'Create WhatsApp repeat-order offers'],
  'Church / nonprofit': ['Create mission, programs, events, and donation sections', 'Add WhatsApp and contact channels', 'Publish announcements and community updates'],
  'School / organization': ['Create admissions, programs, news, and contact pages', 'Add staff/department sections', 'Create parent/student inquiry flow'],
  Marketplace: ['Define vendor onboarding flow', 'Create category landing pages', 'Add commission and payout rules'],
};

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}

function titleCase(value) {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function generateBlueprint(rawData) {
  const data = Object.fromEntries(Object.entries(rawData).map(([key, value]) => [key, escapeHtml(value)]));
  const name = titleCase(data.businessName || 'Your Business');
  const offer = data.offer.trim().toLowerCase();
  const audience = data.audience.trim().toLowerCase();
  const regionIdeas = regionalRecommendations[data.region] || regionalRecommendations.Worldwide;
  const modelIdeas = modelPlaybooks[data.model] || modelPlaybooks['Online store'];

  const headline = `${name}: your ${data.model.toLowerCase()} built with AI.`;
  const subhead = `Xacheus can help ${audience} discover, trust, and buy ${offer}. Start with a mobile-first website, add WhatsApp support, then expand into payments, SEO, marketing, analytics, and customer management.`;

  return `
    <div class="blueprint-intro">
      <p class="eyebrow">Generated Xacheus blueprint</p>
      <h3>${headline}</h3>
      <p>${subhead}</p>
    </div>
    <div class="blueprint-grid">
      <article class="blueprint-card">
        <h4>Website sections</h4>
        <ul>
          <li>Hero promise for ${audience}</li>
          <li>About, services/products, reviews, FAQs, and contact</li>
          <li>WhatsApp CTA and dashboard confirmation flow</li>
        </ul>
      </article>
      <article class="blueprint-card">
        <h4>Business setup</h4>
        <ul>${modelIdeas.map((idea) => `<li>${idea}</li>`).join('')}</ul>
      </article>
      <article class="blueprint-card">
        <h4>Launch strategy</h4>
        <ul>${regionIdeas.map((idea) => `<li>${idea}</li>`).join('')}</ul>
      </article>
    </div>
  `;
}

launchForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(launchForm);
  const data = Object.fromEntries(formData.entries());

  resultPanel.innerHTML = generateBlueprint(data);
  resultPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });

  localStorage.setItem('xacheusBlueprint', JSON.stringify(data));
});

const savedBlueprint = localStorage.getItem('xacheusBlueprint');
if (savedBlueprint && launchForm && resultPanel) {
  try {
    const data = JSON.parse(savedBlueprint);
    Object.entries(data).forEach(([key, value]) => {
      const field = launchForm.elements[key];
      if (field) field.value = value;
    });
    resultPanel.innerHTML = generateBlueprint(data);
  } catch {
    localStorage.removeItem('xacheusBlueprint');
  }
}
