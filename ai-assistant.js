const form = document.querySelector('#assistant-form');
const output = document.querySelector('#assistant-output');
function esc(v){return String(v||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function content(d){
  const name=esc(d.businessName), offer=esc(d.offer), audience=esc(d.audience);
  const templates={
    'WhatsApp sales reply': `Hello 👋 welcome to ${name}. Thank you for asking about ${offer}. We help ${audience} with quality, reliable service. Please tell us your location and quantity needed, and we will send price and delivery details.`,
    'Facebook post': `Your next ${offer} solution is here! ${name} helps ${audience} get trusted service, easy ordering, and quick support. Message us today and let us help you get started. #Xacheus #BusinessWithAI`,
    'Instagram caption': `${name} is built for ${audience}. Discover ${offer}, order easily, and get support fast. Send us a DM or WhatsApp today. ✨`,
    'TikTok content idea': `Show a before/after: customer problem → ${name} solution → happy result. Text overlay: “How ${audience} can get better ${offer} in minutes.” End with WhatsApp CTA.`,
    'Email campaign': `Subject: A better way to get ${offer}\n\nHi, ${name} helps ${audience} save time and buy with confidence. Reply to this email or WhatsApp us to get details, pricing, and support today.`,
    'Product description': `${offer} from ${name} is designed for ${audience} who want quality, trust, and convenience. Add this to your website with benefits, price, delivery details, and WhatsApp order button.`,
    'Business plan summary': `${name} will serve ${audience} by offering ${offer}. The business will acquire customers through WhatsApp, Facebook, SEO, referrals, and a Xacheus-built website/store. Revenue can come from direct sales, repeat orders, service packages, and subscriptions.`,
    'SEO blog idea': `Blog title: How ${audience} Can Choose the Best ${offer}. Include sections: common problems, buying checklist, why ${name}, pricing guidance, and WhatsApp contact CTA.`,
  };
  return templates[d.task];
}
form.addEventListener('submit', e=>{
  e.preventDefault();
  const d=Object.fromEntries(new FormData(form).entries());
  output.innerHTML=`<article class="generated-doc"><p class="eyebrow">Generated ${esc(d.task)}</p><h2>${esc(d.businessName)}</h2><p>${content(d).replace(/\n/g,'<br>')}</p><button class="btn btn-secondary" id="copy-output" type="button">Copy content</button></article>`;
  document.querySelector('#copy-output').onclick=()=>navigator.clipboard.writeText(output.innerText);
});
