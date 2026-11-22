// The selector stays in each language's own script. Text is rendered as text nodes.
const guide = {
  en: ['English','Language','Canyon Clash','36C & 36Z plan','Attack the enemy military base. When the core opens, move in to capture and hold it.','Take the enemy hospital and nearby buildings. When the core opens, follow your commander to support Team A.','Defend our hospital and nearby buildings. After Team A moves to the core, take and hold the enemy military base.','Hold the refineries and help with early Tyrants. When military bases open, move immediately to our military base.','Watch alliance chat, join voice if you can, and follow your commander.'],
  sq: ['Shqip','Gjuha','Canyon Clash','Plani i 36C dhe 36Z','Sulmoni bazën ushtarake të armikut. Kur të hapet bërthama, shkoni ta merrni dhe ta mbani.','Merrni spitalin e armikut dhe ndërtesat pranë tij. Kur të hapet bërthama, ndiqni komandantin për të ndihmuar ekipin A.','Mbroni spitalin tonë dhe ndërtesat pranë tij. Pasi ekipi A të shkojë te bërthama, merrni dhe mbani bazën ushtarake të armikut.','Mbani rafineritë dhe ndihmoni me Tiranët e parë. Kur të hapen bazat ushtarake, shkoni menjëherë në bazën tonë.','Ndiqni bisedën e aleancës, hyni në bisedën me zë nëse mundeni dhe dëgjoni komandantin.'],
  es: ['Español','Idioma','Canyon Clash','Plan de 36C y 36Z','Atacad la base militar enemiga. Cuando se abra el núcleo, id a capturarlo y defenderlo.','Capturad el hospital enemigo y los edificios cercanos. Cuando se abra el núcleo, seguid al comandante para apoyar al equipo A.','Defended nuestro hospital y sus alrededores. Cuando el equipo A vaya al núcleo, capturad y defended la base militar enemiga.','Mantened las refinerías y ayudad contra los primeros Tiranos. Cuando se abran las bases militares, id enseguida a nuestra base.','Revisad el chat de la alianza, entrad al canal de voz si podéis y seguid al comandante.'],
  fr: ['Français','Langue','Canyon Clash','Plan de 36C et 36Z','Attaquez la base militaire ennemie. À l’ouverture du noyau, allez le capturer et le tenir.','Prenez l’hôpital ennemi et les bâtiments proches. À l’ouverture du noyau, suivez votre commandant pour soutenir l’équipe A.','Défendez notre hôpital et les bâtiments proches. Une fois l’équipe A au noyau, prenez et tenez la base militaire ennemie.','Tenez les raffineries et aidez contre les premiers Tyrans. À l’ouverture des bases militaires, rejoignez immédiatement notre base.','Surveillez le chat de l’alliance, rejoignez le vocal si possible et suivez votre commandant.'],
  ar: ['العربية','اللغة','Canyon Clash','خطة 36C و36Z','هاجموا القاعدة العسكرية للعدو. عند فتح النواة، انتقلوا إليها وسيطروا عليها ودافعوا عنها.','سيطروا على مستشفى العدو والمباني القريبة. عند فتح النواة، اتبعوا قائدكم لدعم الفريق A.','دافعوا عن مستشفانا والمباني القريبة. بعد انتقال الفريق A إلى النواة، سيطروا على القاعدة العسكرية للعدو ودافعوا عنها.','حافظوا على المصافي وساعدوا في مواجهة الطغاة الأوائل. عند فتح القواعد العسكرية، انتقلوا فوراً إلى قاعدتنا.','تابعوا دردشة التحالف، وانضموا إلى المحادثة الصوتية إن أمكن، واتبعوا قائدكم.'],
  de: ['Deutsch','Sprache','Canyon Clash','Plan für 36C und 36Z','Greift die feindliche Militärbasis an. Sobald der Kern öffnet, erobert und haltet ihn.','Erobert das feindliche Krankenhaus und die umliegenden Gebäude. Folgt eurem Kommandanten zum Kern und unterstützt Team A.','Verteidigt unser Krankenhaus und die umliegenden Gebäude. Sobald Team A zum Kern wechselt, erobert und haltet die feindliche Militärbasis.','Haltet die Raffinerien und helft bei den ersten Tyrannen. Sobald die Militärbasen öffnen, wechselt sofort zu unserer Basis.','Lest den Allianzchat, nutzt wenn möglich den Sprachchat und folgt eurem Kommandanten.'],
  it: ['Italiano','Lingua','Canyon Clash','Piano di 36C e 36Z','Attaccate la base militare nemica. Quando si apre il nucleo, raggiungetelo, conquistatelo e difendetelo.','Conquistate l’ospedale nemico e gli edifici vicini. Quando si apre il nucleo, seguite il comandante per aiutare la squadra A.','Difendete il nostro ospedale e gli edifici vicini. Quando la squadra A passa al nucleo, conquistate e difendete la base militare nemica.','Tenete le raffinerie e aiutate contro i primi Tiranni. Quando si aprono le basi militari, raggiungete subito la nostra base.','Seguite la chat dell’alleanza, entrate nel canale vocale se potete e seguite il vostro comandante.'],
  el: ['Ελληνικά','Γλώσσα','Canyon Clash','Σχέδιο 36C και 36Z','Επιτεθείτε στην εχθρική στρατιωτική βάση. Μόλις ανοίξει ο πυρήνας, καταλάβετε και κρατήστε τον.','Καταλάβετε το εχθρικό νοσοκομείο και τα γύρω κτίρια. Μόλις ανοίξει ο πυρήνας, ακολουθήστε τον διοικητή σας για να στηρίξετε την ομάδα A.','Υπερασπιστείτε το νοσοκομείο μας και τα γύρω κτίρια. Όταν η ομάδα A πάει στον πυρήνα, καταλάβετε και κρατήστε την εχθρική βάση.','Κρατήστε τα διυλιστήρια και βοηθήστε με τους πρώτους Τυράννους. Όταν ανοίξουν οι βάσεις, πηγαίνετε αμέσως στη δική μας.','Παρακολουθείτε τη συνομιλία της συμμαχίας, μπείτε στη φωνητική συνομιλία αν μπορείτε και ακολουθήστε τον διοικητή σας.'],
  lt: ['Lietuvių','Kalba','Canyon Clash','36C ir 36Z planas','Pulkite priešo karinę bazę. Atsidarius branduoliui, užimkite ir išlaikykite jį.','Užimkite priešo ligoninę ir gretimus pastatus. Atsidarius branduoliui, sekite vadą ir padėkite komandai A.','Ginkite savo ligoninę ir gretimus pastatus. Komandai A persikėlus prie branduolio, užimkite ir išlaikykite priešo karinę bazę.','Išlaikykite naftos perdirbimo gamyklas ir padėkite kovoti su pirmaisiais tironais. Atsidarius karinėms bazėms, iš karto persikelkite į mūsiškę.','Stebėkite aljanso pokalbius, jei galite prisijunkite prie balso kanalo ir klausykite vado.'],
};
export function renderCanyonGuide(main) {
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const section = el('section', '', 'card');
  const heading = el('h1', 'Canyon Clash');
  const label = el('label');
  const labelText = el('span');
  const select = el('select', '', 'select');
  label.append(labelText, select);
  for (const [code, [name]] of Object.entries(guide)) {
    const option = el('option', name);
    option.value = option.lang = code;
    select.append(option);
  }
  const plan = el('div');
  function update() {
    const code = Object.hasOwn(guide, select.value) ? select.value : 'en';
    const [, language, title, subtitle, ...copy] = guide[code];
    heading.textContent = title;
    labelText.textContent = language + ' ';
    labelText.lang = plan.lang = code;
    plan.dir = code === 'ar' ? 'rtl' : 'ltr';
    plan.replaceChildren(el('h2', subtitle));
    for (const [i, role] of copy.slice(0, 4).entries()) {
      const team = el('details');
      team.open = i === 0;
      const summary = el('summary', String.fromCharCode(65 + i));
      summary.setAttribute('aria-label', 'Team ' + summary.textContent);
      team.append(summary, el('p', role));
      plan.append(team);
    }
    plan.append(el('p', copy[4], 'muted'));
    try { localStorage.setItem('36c-canyon-language', code); } catch {}
  }
  try {
    const stored = localStorage.getItem('36c-canyon-language');
    if (Object.hasOwn(guide, stored)) select.value = stored;
  } catch {}
  select.addEventListener('change', update);
  section.append(heading, label, plan);
  main.replaceChildren(section);
  update();
}
