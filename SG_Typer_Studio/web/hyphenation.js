// Where the words of a text may break, by TypeR's own rules (textShapeRLanguage.js and
// textShapeR.js in its repository): the text decides its language, the interface language
// only settles texts too short to tell, and the hyphen library's patterns say where a word
// cuts. In French the syllable rules complete them, as the patterns alone miss some cuts.
// TypeR keeps only the best few cuts for its automatic shapes; here a person chooses, so
// every one of them is offered.

(function () {
  "use strict";

  const PATTERNS = { de: "de", en: "enUs", es: "es", fr: "fr", it: "it", pt: "pt", ru: "ru", tr: "tr", uk: "uk" };
  const LANGUAGES = Object.keys(PATTERNS);

  /* --------------------------- the language of a text --------------------------- */

  // Everyday words that tell the languages apart: words shared between them
  // ("la", "de", "que") are left out on purpose
  const COMMON_WORDS = {
    fr: "je tu il elle nous vous ils elles on moi toi lui le les des du une et est suis es sont ai as ont pas ne ce cette ces ça c'est j'ai qu'il qu'on qu'elle mais pour dans avec sur oui non qui bien très tout ici alors quoi comment pourquoi merci bonjour salut hein ben mon ton son ma ta sa mes tes ses a me te se au aux",
    en: "i you he she we they it him her us them the an and is am are was were be been do does did don't i'm you're it's that's have has had will would can could should not yes what why how who where when this that these those my your his our their of to in for with at but so just",
    es: "yo tú él ella nosotros ellos ellas el los las y soy eres estoy está están qué por para pero con sin sí muy más también aquí ahora porque cómo gracias hola mi tu su mis esto eso nada todo",
    pt: "eu você ele ela nós eles elas os um uma é sou são estou está não sim por para mas sem muito mais também aqui agora porque como obrigado olá meu minha seu sua isso nada tudo",
    de: "ich du er sie wir ihr der die das den dem ein eine einen und ist bin bist sind war nicht ja nein was warum wie wer wo mit für auf aber auch noch schon hier jetzt danke mein dein sein",
    it: "io lei noi voi loro lo gli è sono sei siamo ho hai sì che per ma con senza molto più anche qui ora perché come grazie ciao mio tuo suo questo quello niente tutto",
    tr: "ben sen biz siz onlar bir ve bu şu için ama ile çok daha evet hayır ne neden nasıl kim var yok değil benim senin teşekkürler merhaba",
  };
  const WORD_SETS = Object.keys(COMMON_WORDS).reduce((sets, language) => {
    sets[language] = new Set(COMMON_WORDS[language].split(" "));
    return sets;
  }, {});
  const SIGNATURE_LETTERS = {
    fr: /[êàèùûîïœç]/g,
    es: /[ñ¿¡]/g,
    pt: /[ãõ]/g,
    de: /[äöüß]/g,
    it: /[ìò]/g,
    tr: /[ğışİ]/g,
  };
  const CYRILLIC = /[Ѐ-ӿ]/;
  const UKRAINIAN_LETTERS = /[іїєґ]/i;
  // Scripts written without hyphenated line breaks in manga lettering
  const UNBROKEN_SCRIPTS = /[֐-ࣿ฀-໿぀-ヿ㐀-鿿가-힯]/;
  const LATIN_LETTER = /[A-Za-z\xc0-\xd6\xd8-\xf6\xf8-\xffĀ-ſ]/;

  const detectLanguage = (text) => {
    const lower = String(text || "").toLowerCase();
    const words = lower.replace(/[*_]/g, "").replace(/’/g, "'").split(/[^a-zà-öø-ÿā-ſ']+/).filter(Boolean);
    let best = null;
    let bestScore = 0;
    let runnerUp = 0;
    Object.keys(WORD_SETS).forEach((language) => {
      let score = 0;
      words.forEach((word) => {
        if (WORD_SETS[language].has(word)) score += 1;
      });
      const letters = SIGNATURE_LETTERS[language] && lower.match(SIGNATURE_LETTERS[language]);
      if (letters) score += letters.length * 1.5;
      if (score > bestScore) {
        runnerUp = bestScore;
        bestScore = score;
        best = language;
      } else if (score > runnerUp) {
        runnerUp = score;
      }
    });
    return bestScore > 0 && bestScore > runnerUp ? best : null;
  };

  const interfaceLanguage = PATTERNS[window.TYPER_I18N.lang] ? window.TYPER_I18N.lang : "en";

  // The language a text hyphenates in; null for scripts that do not hyphenate
  const resolve = (text) => {
    const source = String(text || "");
    if (UNBROKEN_SCRIPTS.test(source)) return null;
    if (CYRILLIC.test(source)) return UKRAINIAN_LETTERS.test(source) ? "uk" : "ru";
    if (!LATIN_LETTER.test(source)) return null;
    return detectLanguage(source) || interfaceLanguage;
  };

  /* ------------------------------- the hyphen library ------------------------------ */

  const hyphenators = new Map();
  // The cuts of each word, kept: the same words are asked for at each change of a text
  const known = new Map();
  const KNOWN_MAX = 4000;
  const isLoaded = (language) => !language || hyphenators.has(language);
  const load = async (language) => {
    if (isLoaded(language)) return;
    const [engine, patterns] = await Promise.all([import("./vendor/hyphen/hyphenEngine.js"), import(`./vendor/hyphen/${PATTERNS[language]}Patterns.js`)]);
    hyphenators.set(language, engine.default(patterns.default, { minWordLength: 4 }));
    // The cuts found without these patterns are no longer right
    known.clear();
  };

  const patternPoints = (language, word) => {
    const hyphenator = hyphenators.get(language);
    if (!hyphenator) return [];
    const sections = hyphenator(word).split("­");
    const points = [];
    let offset = 0;
    for (let index = 0; index + 1 < sections.length; index++) {
      offset += sections[index].length;
      points.push(offset);
    }
    return points;
  };

  /* --------------------------------- French syllables -------------------------------- */

  const VOWELS = "aeiouyàâäéèêëîïôöùûüÿœæ";
  const isVowel = (char) => Boolean(char) && VOWELS.indexOf(char) !== -1;
  const isLetter = (char) => /\p{L}/u.test(char || "");
  // A y between two vowels sounds as a consonant: "cro-yable", "vo-yage"
  const vowelAt = (word, index) => isVowel(word[index]) && !(word[index] === "y" && isVowel(word[index - 1]) && isVowel(word[index + 1]));
  const consonantAt = (word, index) => isLetter(word[index]) && !vowelAt(word, index);

  // Consonant clusters that legally start a syllable, and so travel together to the next
  // line: splitting inside one ("tab-leau", "vac-he") cuts mid-syllable
  const FRENCH_ONSETS = new Set([
    "bl", "br", "ch", "cl", "cr", "dr", "fl", "fr", "gl", "gn", "gr", "kl", "kr", "ph", "pl", "pr", "rh", "th", "tr", "vr",
    "chl", "chr", "phl", "phr", "thr",
  ]);

  // Whether a word cuts into two written syllables at `index`. Between vowels and
  // consonants, the cut goes before the consonants that open the next syllable: one, or a
  // cluster that can start a syllable ("mons-tre", "obs-cur", "ap-pren-dre"). `every` also
  // keeps the cuts before a final mute e ("compren-dre"), which automatic hyphenation avoids.
  const isSyllableCut = (word, index, every) => {
    const left = word.slice(0, index);
    const right = word.slice(index);
    if (!Array.from(left).some(isVowel) || !Array.from(right).some(isVowel)) return false;
    // Between two vowels ("thé-âtre"), or between a consonant and its vowel ("mat-in")
    if (!consonantAt(word, index)) return false;
    // French typography: no hyphen before an intervocalic x ("ta-xi")
    if (word[index] === "x" && isVowel(word[index + 1])) return false;
    let start = index;
    while (start > 0 && consonantAt(word, start - 1)) start--;
    let end = index;
    while (end < word.length && consonantAt(word, end)) end++;
    if (start === 0 || end === word.length) return false;
    const cluster = word.slice(start, end);
    let carried = 1;
    for (let size = Math.min(3, cluster.length); size >= 2; size--) {
      if (FRENCH_ONSETS.has(cluster.slice(-size))) {
        carried = size;
        break;
      }
    }
    if (index !== end - carried) return false;
    // A lone aspirated or mute h can't open a carried syllable ("ca-hier")
    if (word.slice(index, end) === "h") return false;
    // Carrying consonants + mute e ("attitu-des") strands a silent syllable
    const rest = word.slice(end);
    if (!every && (rest === "e" || rest === "es")) return false;
    return true;
  };

  // The cuts of a word, 2 letters at least on each side
  const syllablePoints = (word, every) => {
    const lower = word.toLowerCase();
    const points = [];
    for (let index = 2; index <= lower.length - 2; index++) {
      if (isSyllableCut(lower, index, every)) points.push(index);
    }
    return points;
  };

  /* --------------------------------- one word's cuts --------------------------------- */

  // Offsets where a run of letters may cut. Apostrophes can sit inside the run
  // ("aujourd'hui") or around it ('beaucoup'), which is only quoting. `every` is for a
  // person choosing among them (the Line Breaks panel): it offers each syllable, where
  // automatic hyphenation keeps to the cuts typography prefers.
  const breakPoints = (run, language, every) => {
    if (!language) return [];
    const key = `${language}${every ? "+" : "-"}${run}`;
    const kept = known.get(key);
    if (kept) return kept;
    const points = findBreakPoints(run, language, every);
    if (known.size >= KNOWN_MAX) known.clear();
    known.set(key, points);
    return points;
  };
  const findBreakPoints = (run, language, every) => {
    const lead = /^['’]*/.exec(run)[0].length;
    const body = run.slice(lead).replace(/['’]+$/, "");
    const elided = /['’]/.test(body);
    // Only languages that elide cut around an apostrophe: "don't" stays whole
    if (!body || (elided && language !== "fr" && language !== "it")) return [];
    const points = patternPoints(language, body.replace(/’/g, "'"));
    // In French each part around an apostrophe has its syllables: "l'or-di-na-teur"
    if (language === "fr") {
      let offset = 0;
      body.split(/['’]/).forEach((part) => {
        syllablePoints(part, every).forEach((point) => points.push(offset + point));
        offset += part.length + 1;
      });
    }
    return Array.from(new Set(points))
      .filter((index) => index >= 2 && body.length - index >= 2)
      .map((index) => index + lead);
  };

  window.TypeRHyphenation = { LANGUAGES, resolve, load, isLoaded, breakPoints };
})();
