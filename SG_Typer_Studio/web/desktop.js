// What changes when this page runs in SG Typer Studio, the desktop app. Only that app loads this
// file. It is versioned with the renderer and embedded with it in every application build.

(function () {
  "use strict";

  const Desktop = window.TypeRDesktop;
  if (!Desktop) return;

  document.documentElement.classList.add("desktop", `desktop--${Desktop.platform}`);
  try {
    // A window is a window, whatever the screen: the touch interface stays for tablets, and the
    // legacy web-only preference is kept for storage compatibility
    window.localStorage.setItem("typer.web.interface", "desktop");
  } catch (error) {
    console.warn("SG Typer Studio: no storage", error);
  }

  /* --------------------------- a file opened from the system --------------------------- */

  // The app drops it on the window: taken here, it opens as a new page wherever it lands
  const entriesOf = async (transfer) => {
    const found = Array.from(transfer.items).filter((item) => item.kind === "file").map((item) => ({
      file: item.getAsFile(),
      asked: item.getAsFileSystemHandle().catch(() => null),
    }));
    const entries = [];
    for (const { file, asked } of found) {
      const handle = await asked;
      entries.push({ file, handle: handle && handle.kind === "file" ? handle : null });
    }
    return entries;
  };
  window.addEventListener("dragover", (event) => {
    if (!window.TypeRDesktopOpening) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener("dragenter", (event) => {
    if (window.TypeRDesktopOpening) event.stopImmediatePropagation();
  }, true);
  window.addEventListener("drop", async (event) => {
    if (!window.TypeRDesktopOpening) return;
    window.TypeRDesktopOpening = false;
    event.preventDefault();
    event.stopImmediatePropagation();
    const entries = await entriesOf(event.dataTransfer);
    if (entries.length) window.TypeRApp.openFiles(entries);
  }, true);

  /* ------------------------- starting from TypeR for Photoshop ------------------------- */

  // Only the app says this, so its words live here rather than in strings/
  const WORDS = {
    fr: ["Reprendre vos réglages TypeR de Photoshop ?", "TypeR pour Photoshop est installé sur cet ordinateur. SG Typer Studio peut démarrer avec les mêmes styles, dossiers, réglages et raccourcis. Le plugin garde sa propre copie.", "Styles trouvés : {count}", "Les reprendre", "Partir de zéro", "Vos réglages TypeR de Photoshop sont là."],
    es: ["¿Traer tus ajustes de TypeR desde Photoshop?", "TypeR para Photoshop está instalado en este ordenador. SG Typer Studio puede empezar con los mismos estilos, carpetas, ajustes y atajos. El plugin conserva su propia copia.", "Estilos encontrados: {count}", "Traerlos", "Empezar de cero", "Tus ajustes de TypeR de Photoshop ya están aquí."],
    it: ["Riprendere le impostazioni di TypeR da Photoshop?", "TypeR per Photoshop è installato su questo computer. SG Typer Studio può partire con gli stessi stili, cartelle, impostazioni e scorciatoie. Il plugin conserva la sua copia.", "Stili trovati: {count}", "Riprendile", "Parti da zero", "Le tue impostazioni di TypeR da Photoshop sono qui."],
    de: ["Ihre TypeR-Einstellungen aus Photoshop übernehmen?", "TypeR für Photoshop ist auf diesem Computer installiert. SG Typer Studio kann mit denselben Stilen, Ordnern, Einstellungen und Tastenkürzeln starten. Das Plugin behält seine eigene Kopie.", "Gefundene Stile: {count}", "Übernehmen", "Neu beginnen", "Ihre TypeR-Einstellungen aus Photoshop sind da."],
    pt: ["Trazer suas configurações do TypeR do Photoshop?", "O TypeR para Photoshop está instalado neste computador. O SG Typer Studio pode começar com os mesmos estilos, pastas, configurações e atalhos. O plugin mantém sua própria cópia.", "Estilos encontrados: {count}", "Trazer", "Começar do zero", "Suas configurações do TypeR do Photoshop estão aqui."],
    ru: ["Перенести настройки TypeR из Photoshop?", "На этом компьютере установлен TypeR для Photoshop. SG Typer Studio может начать с теми же стилями, папками, настройками и сочетаниями клавиш. У плагина останется своя копия.", "Найдено стилей: {count}", "Перенести", "Начать с нуля", "Ваши настройки TypeR из Photoshop на месте."],
    uk: ["Перенести налаштування TypeR із Photoshop?", "На цьому комп’ютері встановлено TypeR для Photoshop. SG Typer Studio може почати з тими самими стилями, теками, налаштуваннями та сполученнями клавіш. Плагін збереже свою копію.", "Знайдено стилів: {count}", "Перенести", "Почати з нуля", "Ваші налаштування TypeR із Photoshop на місці."],
    pl: ["Przenieść ustawienia TypeR z Photoshopa?", "Na tym komputerze jest zainstalowany TypeR dla Photoshopa. SG Typer Studio może zacząć z tymi samymi stylami, folderami, ustawieniami i skrótami. Wtyczka zachowa własną kopię.", "Znalezione style: {count}", "Przenieś", "Zacznij od zera", "Twoje ustawienia TypeR z Photoshopa są już tutaj."],
    nl: ["Je TypeR-instellingen uit Photoshop overnemen?", "TypeR voor Photoshop staat op deze computer. SG Typer Studio kan beginnen met dezelfde stijlen, mappen, instellingen en sneltoetsen. De plug-in houdt zijn eigen kopie.", "Gevonden stijlen: {count}", "Overnemen", "Opnieuw beginnen", "Je TypeR-instellingen uit Photoshop staan klaar."],
    tr: ["TypeR ayarlarınız Photoshop'tan alınsın mı?", "Bu bilgisayarda Photoshop için TypeR kurulu. SG Typer Studio aynı stiller, klasörler, ayarlar ve kısayollarla başlayabilir. Eklenti kendi kopyasını korur.", "Bulunan stiller: {count}", "Al", "Sıfırdan başla", "Photoshop'taki TypeR ayarlarınız burada."],
    ar: ["هل تريد نقل إعدادات TypeR من Photoshop؟", "TypeR لـ Photoshop مثبّت على هذا الحاسوب. يمكن لـ SG Typer Studio أن يبدأ بالأنماط والمجلدات والإعدادات والاختصارات نفسها. تحتفظ الإضافة بنسختها الخاصة.", "الأنماط الموجودة: {count}", "انقلها", "ابدأ من جديد", "إعدادات TypeR من Photoshop أصبحت هنا."],
    vi: ["Chuyển cài đặt TypeR từ Photoshop sang?", "Máy tính này đã cài TypeR cho Photoshop. SG Typer Studio có thể bắt đầu với cùng các kiểu chữ, thư mục, cài đặt và phím tắt. Plugin vẫn giữ bản riêng của nó.", "Số kiểu chữ tìm thấy: {count}", "Chuyển sang", "Bắt đầu từ đầu", "Cài đặt TypeR từ Photoshop của bạn đã có ở đây."],
    id: ["Bawa pengaturan TypeR dari Photoshop?", "TypeR untuk Photoshop terpasang di komputer ini. SG Typer Studio bisa dimulai dengan gaya, folder, pengaturan, dan pintasan yang sama. Plugin tetap menyimpan salinannya sendiri.", "Gaya yang ditemukan: {count}", "Bawa", "Mulai dari awal", "Pengaturan TypeR dari Photoshop sudah ada di sini."],
    th: ["นำการตั้งค่า TypeR จาก Photoshop มาใช้ไหม", "คอมพิวเตอร์เครื่องนี้ติดตั้ง TypeR สำหรับ Photoshop ไว้ SG Typer Studio เริ่มต้นด้วยสไตล์ โฟลเดอร์ การตั้งค่า และคีย์ลัดเดียวกันได้ ปลั๊กอินยังเก็บสำเนาของตัวเองไว้", "สไตล์ที่พบ: {count}", "นำมาใช้", "เริ่มใหม่", "การตั้งค่า TypeR จาก Photoshop อยู่ที่นี่แล้ว"],
    ja: ["Photoshop の TypeR の設定を引き継ぎますか？", "このコンピューターには Photoshop 用 TypeR がインストールされています。SG Typer Studio は同じスタイル、フォルダー、設定、ショートカットで始められます。プラグイン側の設定はそのまま残ります。", "見つかったスタイル：{count}", "引き継ぐ", "新しく始める", "Photoshop の TypeR の設定を引き継ぎました。"],
    ko: ["Photoshop의 TypeR 설정을 가져올까요?", "이 컴퓨터에 Photoshop용 TypeR가 설치되어 있습니다. SG Typer Studio는 같은 스타일, 폴더, 설정, 단축키로 시작할 수 있습니다. 플러그인은 자체 사본을 그대로 유지합니다.", "찾은 스타일: {count}", "가져오기", "새로 시작", "Photoshop의 TypeR 설정을 가져왔습니다."],
    zh: ["要沿用 Photoshop 中 TypeR 的设置吗？", "这台电脑上装有 Photoshop 版 TypeR。SG Typer Studio 可以使用相同的样式、文件夹、设置和快捷键开始。插件会保留自己的那一份。", "找到的样式：{count}", "沿用", "从头开始", "Photoshop 中 TypeR 的设置已经带过来了。"],
  };
  const ENGLISH = ["Bring your TypeR settings over from Photoshop?", "TypeR for Photoshop is installed on this computer. SG Typer Studio can start with the same styles, folders, settings and shortcuts. The plugin keeps its own copy.", "Styles found: {count}", "Bring them over", "Start fresh", "Your TypeR settings from Photoshop are here."];
  const words = () => WORDS[window.TYPER_I18N && window.TYPER_I18N.lang] || ENGLISH;

  // What only the plugin needs: its update checks, its own log, a background image left behind
  const PLUGIN_ONLY = ["language", "checkUpdates", "autoUpdate", "lastUpdateCheckAt", "backgroundImage", "mcpOperations", "mcpProgress"];
  const STORAGE_FILE = /^storage(_profile_.+)?$/;
  const OFFERED = "typer.studio.photoshopOffered";

  const styleCount = (text) => {
    try {
      const styles = JSON.parse(text).styles;
      return Array.isArray(styles) ? styles.length : 0;
    } catch (error) {
      return 0;
    }
  };

  // Someone who already made styles here keeps them: the question at start doesn't come then.
  // The setup assistant still offers them, saying what they replace.
  const hasOwnStyles = () => {
    const Kit = window.TypeRKit;
    return Kit.storedPaths().some((file) => Kit.keeps(file) && styleCount(Kit.read(file)) > 0);
  };

  // TypeR for Photoshop's files, made ready for here: { files, styles, replaces }, or null
  // without them. `overOwn` finds them even when there are styles here already.
  const findPhotoshopSettings = async ({ overOwn = false } = {}) => {
    const replaces = hasOwnStyles();
    if (!Desktop.findPhotoshopSettings || (replaces && !overOwn)) return null;
    const Kit = window.TypeRKit;
    const found = await Desktop.findPhotoshopSettings();
    if (!found || !found.files) return null;
    const files = {};
    let styles = 0;
    Object.keys(found.files).forEach((name) => {
      try {
        const value = JSON.parse(found.files[name]);
        if (STORAGE_FILE.test(name)) {
          PLUGIN_ONLY.forEach((key) => { delete value[key]; });
          Object.assign(value, { checkUpdates: false, autoUpdate: false, textShapeRPerformanceTipShown: true });
          // As for anyone starting here (Kit.freshStorage): no tour of what 3.0 changed in Photoshop
          if (!(parseFloat(value.whatsNewSeen) >= 3)) value.whatsNewSeen = "3.0";
          if (value.editorTheme === "custom-image") value.editorTheme = "system";
          // A script's pages are files on the disk, which the page can't open by their path:
          // the script stays, its pages are loaded again here
          if (Array.isArray(value.tabs)) value.tabs.forEach((tab) => {
            if (!tab || typeof tab !== "object") return;
            // A name taken from the pages' folder stays
            if (Array.isArray(tab.images) && tab.images.length) tab.autoName = false;
            tab.images = [];
            tab.lastOpenedImagePath = null;
          });
          if (Array.isArray(value.styles)) styles += value.styles.length;
        }
        files[`${Kit.ROOT}/${name}`] = JSON.stringify(value);
      } catch (error) {
        console.warn("SG Typer Studio: a file of TypeR for Photoshop can't be read", name, error);
      }
    });
    return Object.keys(files).length ? { files, styles, replaces } : null;
  };

  // The panel isn't running: its files are replaced whole, profiles included
  const takePhotoshopSettings = async ({ files }) => {
    const Kit = window.TypeRKit;
    try {
      window.localStorage.setItem(OFFERED, "taken");
    } catch (error) {
      console.warn("SG Typer Studio: no storage", error);
    }
    await Promise.all(Kit.storedPaths().filter((file) => Kit.keeps(file) && !files[file]).map((file) => Kit.forget(file)));
    const kept = await Promise.all(Object.keys(files).map((file) => Kit.keep(file, files[file])));
    if (kept.every(Boolean)) window.TypeRApp.toast(words()[5]);
  };

  // Asked once, on a first start, when the setup assistant (onboarding.js) didn't ask it
  const offerPhotoshopSettings = async () => {
    const App = window.TypeRApp;
    try {
      if (window.localStorage.getItem(OFFERED)) return;
    } catch (error) {
      return;
    }
    const found = await findPhotoshopSettings();
    if (!found) return;
    const [title, text, count, yes, no] = words();
    const body = document.createElement("div");
    body.style.display = "grid";
    body.style.gap = "8px";
    [text, found.styles ? App.fill(count, { count: found.styles }) : null].filter(Boolean).forEach((line) => {
      const p = document.createElement("p");
      p.textContent = line;
      body.appendChild(p);
    });
    const answer = await App.dialog({ title, body, ok: yes, cancel: no });
    if (answer) await takePhotoshopSettings(found);
    else {
      try {
        window.localStorage.setItem(OFFERED, "declined");
      } catch (error) {
        console.warn("SG Typer Studio: no storage", error);
      }
    }
  };
  window.TypeRStudio = { beforePanel: offerPhotoshopSettings, findPhotoshopSettings, takePhotoshopSettings, OFFERED };

  /* ------------------------------- Discord's Rich Presence ------------------------------ */

  // What the page is on goes to the app when it changes (Settings > Discord activity). The app
  // spaces the changes out as Discord asks, and shows nothing while Discord isn't running.
  const PRESENCE_EVERY = 5000;
  const watchPresence = () => {
    const App = window.TypeRApp;
    if (!Desktop.discord || !App.presence) return;
    let said = "";
    const tell = () => {
      const now = App.presence();
      const key = JSON.stringify(now);
      if (key === said) return;
      said = key;
      Desktop.discord.set(now);
    };
    tell();
    setInterval(tell, PRESENCE_EVERY);
  };

  // The page's scripts have run; bringing the last session back still takes its time
  const whenLoaded = () => {
    const App = window.TypeRApp;
    Desktop.setStrings({
      closeTitle: App.T("Save your changes before closing?"),
      protectedPlace: App.T("This place is protected by the system. Choose another one."),
      ok: App.T("OK"),
      discard: App.T("Don't save"),
      cancel: App.T("Cancel"),
    });
    watchPresence();
    // The computer's fonts are there from the start (main.js grants them). One installed while
    // the app is open shows up when the app is back in front.
    let fontsAsked = 0;
    window.addEventListener("focus", () => {
      if (Date.now() - fontsAsked < 5000) return;
      fontsAsked = Date.now();
      window.TypeRFonts.useInstalled().catch(() => {});
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.title = "SG Typer Studio";
    document.querySelectorAll(".mbar__title, .start h1").forEach((title) => { title.textContent = "SG Typer Studio"; });
    if (!window.TypeRApp) return;
    whenLoaded();
    if (window.TypeRApp.booted) Desktop.ready();
    else window.addEventListener("typer-booted", () => Desktop.ready(), { once: true });
  });
})();
