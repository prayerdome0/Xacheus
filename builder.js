import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { addDoc, collection } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth, db, serverTimestamp } from "./firebase.js";
import { generateWithAI, getPollinationsImage } from "./ai-config.js";

const form = document.querySelector("#real-builder-form");
const saveButton = document.querySelector("#save-generated-site");
const statusEl = document.querySelector("#builder-save-status");
let currentUser = null;
let generatedSite = null;

onAuthStateChanged(auth, (user) => { currentUser = user; });

const colors = {
  "Premium Tech": ["#02070d", "#00b8f4", "#12e1b2"],
  "Clean Business": ["#ffffff", "#1457ff", "#0f172a"],
  "Bold E-commerce": ["#111827", "#ff7a18", "#ffe082"],
  "Warm Community": ["#15100b", "#f59e0b", "#84cc16"],
};

function esc(value) {
  return String(value || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function title(value) {
  return esc(value).trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

function generate(data) {
  const name = title(data.businessName);
  const offer = esc(data.offer).toLowerCase();
  const audience = esc(data.audience).toLowerCase();
  const region = esc(data.region);
  const cta = esc(data.cta);
  const [bg, accent, second] = colors[data.style] || colors["Premium Tech"];
  const headline = `${name} helps ${audience} find ${offer} faster.`;
  const subheadline = `A professional ${esc(data.businessType).toLowerCase()} experience built for ${region}, with mobile-first design, WhatsApp conversion, SEO, and customer trust sections.`;
  const products = [
    `Featured ${offer}`,
    `Premium ${offer} package`,
    `Custom ${offer} solution`,
  ];
  const sections = ["Hero", "Benefits", "Products/Services", "Testimonials", "FAQ", "WhatsApp Contact"];
  const launch = [
    "Confirm logo, colors, and business name",
    "Add 3–12 products or service packages",
    "Connect WhatsApp admin +260 973 028 342",
    "Add payment confirmation instructions",
    "Publish contact form and customer inquiry flow",
    "Share launch post on Facebook, WhatsApp, Instagram, and TikTok",
    "Track leads in the Xacheus admin dashboard",
  ];
  return { ...data, name, headline, subheadline, products, sections, launch, bg, accent, second,
    seoTitle: `${name} | ${title(data.offer)} in ${region}`,
    seoDescription: `${name} provides ${offer} for ${audience}. Order, contact, and grow with a mobile-ready website powered by Xacheus AI.`,
    whatsapp: `Hello ${name}, I am interested in ${offer}. Please send me prices and details.`,
    status: "Generated",
  };
}

function render(site) {
  const heroStyle = site.heroImage 
    ? `background-image:linear-gradient(rgba(0,0,0,0.45),rgba(0,0,0,0.35)),url('${site.heroImage}');background-size:cover;background-position:center`
    : `background: radial-gradient(circle at 85% 20%, var(--preview-accent), transparent 22rem)`;

  document.querySelector("#tab-preview").innerHTML = `
    <article class="site-preview" style="--preview-bg:${site.bg};--preview-accent:${site.accent};--preview-second:${site.second}">
      <header><b>${site.name}</b><nav><span>Home</span><span>Shop</span><span>Contact</span></nav></header>
      <section class="preview-hero" style="${heroStyle}"><div><small>Built with Xacheus AI</small><h2>${site.headline}</h2><p>${site.subheadline}</p><a>${site.cta}</a></div></section>
      <section class="preview-products">${site.products.map((p, i) => `<div><span>0${i + 1}</span><h3>${p}</h3><p>Clear description, benefits, price placeholder, and WhatsApp order action.</p></div>`).join("")}</section>
      <footer>WhatsApp: +260 973 028 342 • ${site.region}</footer>
    </article>`;
  document.querySelector("#tab-copy").innerHTML = `
    <div class="generated-doc"><h3>Homepage copy</h3><p><b>Headline:</b> ${site.headline}</p><p><b>Subheadline:</b> ${site.subheadline}</p><p><b>Sections:</b> ${site.sections.join(" → ")}</p><p><b>WhatsApp message:</b> ${site.whatsapp}</p></div>`;
  document.querySelector("#tab-seo").innerHTML = `
    <div class="generated-doc"><h3>SEO package</h3><p><b>Title:</b> ${site.seoTitle}</p><p><b>Description:</b> ${site.seoDescription}</p><p><b>Keywords:</b> ${site.offer}, ${site.businessType}, ${site.region}, WhatsApp orders, online business</p></div>`;
  document.querySelector("#tab-launch").innerHTML = `
    <div class="generated-doc"><h3>Launch checklist</h3><ol>${site.launch.map((i) => `<li>${i}</li>`).join("")}</ol></div>`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const data = Object.fromEntries(new FormData(form).entries());
  const status = document.getElementById('ai-status');
  
  generatedSite = generate(data);
  
  // Use 100% free keyless AI by default (Pollinations)
  status.textContent = `Generating with free AI (no key required)...`;

  try {
    const prompt = `Create professional website content for "${data.businessName}". They offer ${data.offer} to ${data.audience} in ${data.region}. Business type: ${data.businessType}. Style: ${data.style}. Give me: headline (max 12 words), subheadline (max 25 words), and exactly 3 short product/service names.`;

    // Always call the free keyless version first
    const aiText = await generateWithAI(prompt, "pollinations");

    // Smart parsing of AI output
    const lines = aiText.split('\n').filter(l => l.trim());
    if (lines.length >= 1) generatedSite.headline = lines[0].slice(0, 110);
    if (lines.length >= 2) generatedSite.subheadline = lines[1].slice(0, 180);
    
    // Extract products
    const productMatches = aiText.match(/[•\-\d][\.\)]?\s*([A-Za-z][^\n]{4,40})/g) || [];
    if (productMatches.length >= 2) {
      generatedSite.products = productMatches.slice(0, 3).map(p => p.replace(/^[•\-\d][\.\)]?\s*/, '').trim());
    }

    // Always add a beautiful free image
    const imgPrompt = `${data.businessName} ${data.offer} modern website hero image, ${data.style.toLowerCase()} African business style, teal and blue tones, professional`;
    generatedSite.heroImage = getPollinationsImage(imgPrompt, 920, 440);

    status.textContent = `Generated with 100% free AI (Pollinations.ai)`;

  } catch (err) {
    console.warn('Free AI error, using local:', err);
    status.textContent = `Using built-in generator (free)`;
  }

  render(generatedSite);
  statusEl.textContent = "Generated with AI. Log in and save this site to your dashboard.";
});

// NEW: Interactive AI refinement chat
const refineInput = document.createElement('div');
refineInput.innerHTML = `
  <div style="margin-top:16px;border-top:1px solid var(--line);padding-top:16px">
    <label style="font-size:0.9rem">Refine with AI (e.g. “make it more premium”, “add 3 more products”, “change colors to green”)</label>
    <div style="display:flex;gap:8px;margin-top:6px">
      <input id="refine-prompt" placeholder="Refine the site..." style="flex:1">
      <button type="button" class="btn btn-secondary" id="refine-btn">Apply</button>
    </div>
  </div>`;
document.querySelector('.builder-input-panel').appendChild(refineInput);

document.getElementById('refine-btn').addEventListener('click', () => {
  const prompt = document.getElementById('refine-prompt').value.trim().toLowerCase();
  if (!generatedSite || !prompt) return;

  // Simple rule-based refinements (simulated AI)
  let updated = { ...generatedSite };

  if (prompt.includes('premium') || prompt.includes('luxury')) {
    updated.headline = updated.headline.replace(/helps/, 'delivers premium');
    updated.subheadline = 'Premium experience. Exceptional quality and service.';
    updated.bg = '#0a111f'; updated.accent = '#c5a46e';
  }
  if (prompt.includes('color') || prompt.includes('green')) {
    updated.bg = '#0b1f15'; updated.accent = '#22c55e'; updated.second = '#86efac';
  }
  if (prompt.includes('product')) {
    updated.products = [...updated.products, 'Limited Edition', 'Bundle Deal', 'Premium Add-on'];
  }
  if (prompt.includes('whatsapp')) {
    updated.cta = 'Order on WhatsApp';
    updated.whatsapp = `Hi ${updated.name}, I want to order now!`;
  }
  if (prompt.includes('seo') || prompt.includes('blog')) {
    updated.seoTitle = `${updated.name} — Best ${updated.offer} in ${updated.region}`;
  }

  generatedSite = updated;
  render(generatedSite);
  document.getElementById('refine-prompt').value = '';
  statusEl.textContent = 'AI refinement applied!';
});

// Export generated site as standalone HTML
document.getElementById('export-html')?.addEventListener('click', () => {
  if (!generatedSite) {
    statusEl.textContent = 'Generate a site first.';
    return;
  }
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${generatedSite.name}</title>
<style>body{font-family:Inter,system-ui,sans-serif;background:#07111f;color:#f6fbff;padding:40px 20px;max-width:980px;margin:auto;line-height:1.6}header,footer{background:#0d1d32;padding:20px;border-radius:16px;margin:20px 0} .hero{padding:60px 0;text-align:center} .section{margin:40px 0} button, .cta{background:#72f2b6;color:#06121f;border:none;padding:14px 28px;border-radius:999px;font-weight:700;cursor:pointer}</style>
</head><body>
<header><h1>${generatedSite.name}</h1><p>${generatedSite.subheadline}</p></header>
<main>
<div class="hero"><h2>${generatedSite.headline}</h2><p>${generatedSite.subheadline}</p><a class="cta" href="https://wa.me/260973028342?text=${encodeURIComponent(generatedSite.whatsapp)}">${generatedSite.cta}</a></div>
<div class="section"><h3>Products / Services</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px">${generatedSite.products.map(p=>`<div style="border:1px solid #334455;border-radius:16px;padding:18px"><h4>${p}</h4><p>Great choice for ${generatedSite.audience}. Order now.</p><button onclick="window.location='https://wa.me/260973028342'">Order via WhatsApp</button></div>`).join('')}</div></div>
</main>
<footer><p>Powered by Xacheus AI • WhatsApp: +260 973 028 342 • ${generatedSite.region}</p></footer>
</body></html>`;
  const blob = new Blob([html], {type:'text/html'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${generatedSite.businessName || 'xacheus-site'}.html`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  statusEl.textContent = 'HTML exported!';
});

saveButton.addEventListener("click", async () => {
  if (!generatedSite) {
    statusEl.textContent = "Generate a website preview first.";
    return;
  }
  if (!currentUser) {
    localStorage.setItem("xacheusGeneratedSite", JSON.stringify(generatedSite));
    window.location.href = "auth.html";
    return;
  }
  statusEl.textContent = "Saving to Firebase…";
  await addDoc(collection(db, "users", currentUser.uid, "blueprints"), {
    ...generatedSite,
    userId: currentUser.uid,
    userEmail: currentUser.email,
    createdAt: serverTimestamp(),
  });
  statusEl.textContent = "Saved to your Xacheus dashboard.";
});

document.querySelectorAll(".generation-tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".generation-tabs button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".generation-output").forEach((p) => p.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#tab-${button.dataset.tab}`).classList.add("active");
  });
});

// Add copy buttons to all generated tabs
function addCopyButtons() {
  document.querySelectorAll('.generation-output').forEach((panel) => {
    if (panel.querySelector('.copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary copy-btn';
    btn.style.cssText = 'margin-top:12px;font-size:0.8rem;padding:6px 14px';
    btn.textContent = 'Copy to clipboard';
    btn.onclick = () => {
      const text = panel.innerText.trim();
      navigator.clipboard.writeText(text).then(() => {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = orig, 1400);
      });
    };
    panel.appendChild(btn);
  });
}
setTimeout(addCopyButtons, 600);

const saved = localStorage.getItem("xacheusGeneratedSite");
if (saved) {
  generatedSite = JSON.parse(saved);
  render(generatedSite);
}

// Support quick templates from templates.html
const incomingTemplate = localStorage.getItem('xacheusTemplate');
if (incomingTemplate && !saved) {
  // auto-fill a template when arriving from templates page
  const templates = {
    shoe: { businessName: 'Zed Shoe Market', prompt: 'Online shoe store', businessType: 'Online Store', audience: 'Families and professionals', offer: 'shoes and sneakers', region: 'Zambia', style: 'Bold E-commerce', cta: 'Order on WhatsApp' },
    food: { businessName: 'Kalomo Fresh Foods', prompt: 'Restaurant and delivery', businessType: 'Restaurant / Food', audience: 'Families and offices', offer: 'meals and catering', region: 'Zambia', style: 'Warm Community', cta: 'Order on WhatsApp' },
    church: { businessName: 'Grace Community Church', prompt: 'Church website', businessType: 'Church / Ministry', audience: 'Community members', offer: 'worship and giving', region: 'Southern Africa', style: 'Warm Community', cta: 'Contact Us' },
    retail: { businessName: 'Lusaka Trend Co.', prompt: 'Fashion store', businessType: 'Online Store', audience: 'Young adults', offer: 'clothing & accessories', region: 'Africa', style: 'Premium Tech', cta: 'Shop Now' },
    school: { businessName: 'Sunrise Academy', prompt: 'School site', businessType: 'School / Organization', audience: 'Parents and students', offer: 'education programs', region: 'Zambia', style: 'Clean Business', cta: 'Enroll Now' },
    services: { businessName: 'Smart Growth Consulting', prompt: 'Professional services', businessType: 'Services', audience: 'Entrepreneurs and SMEs', offer: 'business consulting', region: 'Worldwide', style: 'Premium Tech', cta: 'Book a Consultation' }
  };
  const data = templates[incomingTemplate] || templates.shoe;
  generatedSite = generate(data);
  render(generatedSite);
  localStorage.removeItem('xacheusTemplate');
  statusEl.textContent = 'Template loaded — refine or save!';
}

// Quick templates
document.querySelectorAll('[data-template]').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.template;
    const formData = new FormData(form);
    let data = Object.fromEntries(formData.entries());

    if (t === 'shoe') {
      data.businessName = 'Zed Shoe Market';
      data.prompt = 'Create an online store for my shoe business with WhatsApp ordering and delivery in Zambia.';
      data.businessType = 'Online Store';
      data.audience = 'Families, students, and urban professionals';
      data.offer = 'Quality shoes, sneakers, and boots';
      data.style = 'Bold E-commerce';
      data.cta = 'Order on WhatsApp';
      data.region = 'Zambia';
    } else if (t === 'food') {
      data.businessName = 'Kalomo Fresh Foods';
      data.prompt = 'Restaurant and delivery menu with WhatsApp ordering';
      data.businessType = 'Restaurant / Food';
      data.audience = 'Families and local offices';
      data.offer = 'Fresh meals and catering';
      data.style = 'Warm Community';
      data.cta = 'Order on WhatsApp';
      data.region = 'Zambia';
    } else if (t === 'church') {
      data.businessName = 'Grace Community Church';
      data.prompt = 'Church website with events, donations, and WhatsApp';
      data.businessType = 'Church / Ministry';
      data.audience = 'Community members and families';
      data.offer = 'Worship, programs, and giving';
      data.style = 'Warm Community';
      data.cta = 'Contact Us';
      data.region = 'Southern Africa';
    } else if (t === 'retail') {
      data.businessName = 'Lusaka Trend Co.';
      data.prompt = 'Fashion boutique with online store';
      data.businessType = 'Online Store';
      data.audience = 'Young adults and professionals';
      data.offer = 'Trendy clothing and accessories';
      data.style = 'Premium Tech';
      data.cta = 'Shop Now';
      data.region = 'Africa';
    }

    // fill the form
    Object.keys(data).forEach(k => {
      const el = form.elements[k];
      if (el) el.value = data[k];
    });

    // trigger generate
    generatedSite = generate(data);
    render(generatedSite);
    statusEl.textContent = 'Template loaded. Customize and refine!';
  });
});
