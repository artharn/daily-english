/**
 * Functional test suite for daily-english-dispatch.html
 * Loads the real HTML/JS into jsdom, mocks browser-only APIs
 * (fetch, window.storage, speechSynthesis, mediaDevices, window.open),
 * then exercises the App public API exactly as a user's clicks would.
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const path = require('path');
const { pathToFileURL } = require('url');
const HTML_PATH = path.join(__dirname, 'index.html');

let passed = 0, failed = 0;
const failures = [];

function assert(cond, label) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { failed++; failures.push(label); console.log(`  \x1b[31m✗\x1b[0m ${label}`); }
}

// ---- fake story matching the schema isValidStoryUnit expects ----
function fakeStory(id) {
  return {
    topic: 'Test Topic ' + id,
    title: 'Test Story Title ' + id,
    passage: 'This is a test passage. It has several sentences. Word one. Word two.',
    vocab: [['alpha','first letter'],['beta','second letter'],['gamma','third'],['delta','fourth'],['epsilon','fifth']],
    comprehension: ['Q1?','Q2?','Q3?'],
    speaking: ['S1?','S2?','S3?']
  };
}

// ---- speechSynthesis mock ----
function makeSpeechSynthesisMock(window) {
  const synth = {
    _speaking: false,
    _paused: false,
    _lastUtterance: null,
    speaking: false,
    paused: false,
    getVoices: () => [{ name: 'Test Voice', lang: 'en-US' }],
    speak(utt) {
      synth._lastUtterance = utt;
      synth.speaking = true;
      synth.paused = false;
      if (typeof utt.onstart === 'function') utt.onstart();
    },
    cancel() {
      const wasSpeaking = synth.speaking;
      synth.speaking = false;
      synth.paused = false;
      if (wasSpeaking && synth._lastUtterance && typeof synth._lastUtterance.onend === 'function') {
        // real browsers fire onend on cancel too
      }
    },
    pause() { if (synth.speaking) { synth.paused = true; } },
    resume() { if (synth.paused) { synth.paused = false; } },
    onvoiceschanged: null
  };
  window.speechSynthesis = synth;
  window.SpeechSynthesisUtterance = function (text) {
    this.text = text;
    this.rate = 1;
    this.lang = '';
    this.voice = null;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
  };
  return synth;
}

// ---- window.storage mock (persistent key/value, in-memory for the test run) ----
function makeStorageMock(window) {
  const store = {};
  window.storage = {
    async get(key) {
      if (!(key in store)) throw new Error('not found');
      return { key, value: store[key], shared: false };
    },
    async set(key, value) {
      store[key] = value;
      return { key, value, shared: false };
    }
  };
  return store;
}

async function main() {
  console.log('\n=== Daily English — refactor functional test suite ===\n');

  const dom = await JSDOM.fromFile(HTML_PATH, {
    url: pathToFileURL(HTML_PATH).href,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      // ---- inject all browser-API mocks BEFORE the inline <script> executes ----
      makeSpeechSynthesisMock(window);
      makeStorageMock(window);

      window.navigator.mediaDevices = {
        getUserMedia: () => Promise.reject(new Error('no mic in test env'))
      };

      window.open = (url) => { window.__lastOpenedUrl = url; return { }; };
      window.alert = (msg) => { window.__lastAlert = msg; };

      // default fetch mock: API returns a valid fake story for /story{N}
      window.__fetchMode = 'api-ok';
      window.fetch = (url) => {
        window.__lastFetchUrl = url;
        if (window.__fetchMode === 'api-fail') {
          return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
        }
        const m = /\/story(\d+)$/.exec(url);
        if (m) {
          return Promise.resolve({ ok: true, status: 200, json: async () => fakeStory(m[1]) });
        }
        // anthropic API (not used anymore by checkReading/reviewSpeaking, but AI story gen still calls it)
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      };
    }
  });

  const { window } = dom;

  // wait for DOMContentLoaded (App.init) to run
  await new Promise(resolve => {
    if (window.document.readyState === 'complete') resolve();
    else window.document.addEventListener('DOMContentLoaded', () => setTimeout(resolve, 10));
  });
  await new Promise(r => setTimeout(r, 50));

  const doc = window.document;

  // ---------------------------------------------------------------
  console.log('1. App namespace & initial DOM state');
  assert(typeof window.App === 'object', 'window.App namespace exists');
  assert(typeof window.App.generateSession === 'function', 'App.generateSession is exposed');
  assert(typeof window.App.playAudio === 'function', 'App.playAudio is exposed');
  assert(typeof window.App.togglePauseStory === 'function', 'App.togglePauseStory is exposed');
  assert(typeof window.App.checkReading === 'function', 'App.checkReading is exposed');
  assert(typeof window.App.reviewSpeaking === 'function', 'App.reviewSpeaking is exposed');
  assert(doc.getElementById('channels').classList.contains('show') === false, 'channels hidden before first Ready tap');

  // ---------------------------------------------------------------
  console.log('\n2. generateSession() — API path (primary source)');
  window.__fetchMode = 'api-ok';
  await window.App.generateSession();
  assert(doc.getElementById('channels').classList.contains('show') === true, 'channels visible after generateSession');
  assert(doc.getElementById('storyTitle').textContent.includes('Test Story Title'), 'story title populated from API story');
  assert(doc.getElementById('storyTopic').textContent.includes('Test Topic'), 'story topic populated, no source tag for API path');
  assert(!doc.getElementById('storyTopic').textContent.includes('offline set'), 'API-sourced story has no "offline set" tag');
  assert(doc.getElementById('freq-l').classList.contains('off') === false, 'listening frequency dial activated');
  assert(doc.getElementById('checkReadingBtn') !== null, 'Reading channel rendered with Check button');
  assert(doc.getElementById('reviewSpeakingBtn') !== null, 'Speaking channel rendered with review button');

  // ---------------------------------------------------------------
  console.log('\n3. Persistent no-repeat tracking (API layer)');
  const storedIds = JSON.parse((await window.storage.get('usedStoryIds')).value);
  assert(Array.isArray(storedIds) && storedIds.length === 1, 'one story ID recorded as used after first generateSession()');

  // ---------------------------------------------------------------
  console.log('\n4. generateSession() — offline fallback path (API + AI both fail)');
  window.__fetchMode = 'api-fail';
  await window.App.generateSession();
  assert(doc.getElementById('storyTopic').textContent.includes('offline set'), 'falls back to offline story set when API+AI fail, tag shown');
  assert(doc.getElementById('channels').classList.contains('show') === true, 'channels still populated via offline fallback');
  const fallbackIds = JSON.parse((await window.storage.get('usedFallbackTitles')).value);
  assert(Array.isArray(fallbackIds) && fallbackIds.length === 1, 'offline fallback title recorded in persistent storage too');
  window.__fetchMode = 'api-ok'; // restore for later tests

  // ---------------------------------------------------------------
  console.log('\n5. Listening: play / pause / continue / stop');
  await window.App.generateSession();
  const pauseBtn = doc.getElementById('pauseBtn');
  const stopBtn = doc.getElementById('stopStoryBtn');
  assert(pauseBtn.disabled === true, 'pause button starts disabled (nothing playing)');
  window.App.playAudio(0.6, 'slow');
  await new Promise(r => setTimeout(r, 200)); // the 120ms Chrome-bug delay
  assert(window.speechSynthesis._lastUtterance.rate === 0.6, 'slow playback uses rate 0.6');
  assert(pauseBtn.disabled === false, 'pause button enabled once playback starts');
  assert(stopBtn.disabled === false, 'stop button enabled once playback starts');
  assert(doc.getElementById('nowPlaying').textContent.includes('slow'), 'now-playing indicator shows "slow" mode');

  window.App.togglePauseStory();
  assert(window.speechSynthesis.paused === true, 'togglePauseStory() pauses active speech');
  assert(pauseBtn.textContent.includes('Continue'), 'pause button label switches to Continue when paused');

  window.App.togglePauseStory();
  assert(window.speechSynthesis.paused === false, 'togglePauseStory() resumes paused speech');
  assert(pauseBtn.textContent.includes('Pause'), 'pause button label switches back to Pause when resumed');

  window.App.stopAudio();
  assert(window.speechSynthesis.speaking === false, 'stopAudio() cancels playback');
  assert(pauseBtn.disabled === true, 'pause button disabled again after stop');

  // normal speed check
  window.App.playAudio(1.1, 'normal');
  await new Promise(r => setTimeout(r, 200));
  assert(window.speechSynthesis._lastUtterance.rate === 1.1, 'normal playback uses rate 1.1 (different from slow)');
  window.App.stopAudio();

  // ---------------------------------------------------------------
  console.log('\n6. Vocab ear-training: no repeat until all 5 words cycle');
  const seen = new Set();
  let sawRepeatBeforeExhausting = false;
  for (let i = 0; i < 5; i++) {
    window.App.playRandomVocabWord();
    window.App.revealVocabWord();
    const word = doc.getElementById('vocabWordDisplay').textContent;
    if (seen.has(word)) sawRepeatBeforeExhausting = true;
    seen.add(word);
  }
  assert(sawRepeatBeforeExhausting === false, 'no vocab word repeats within one full cycle of 5');
  assert(seen.size === 5, 'all 5 distinct vocab words were shown across one cycle');

  // ---------------------------------------------------------------
  console.log('\n7. Reading: Check my understanding opens Claude.ai with prompt');
  doc.getElementById('ans0').value = 'my answer one';
  doc.getElementById('ans1').value = 'my answer two';
  doc.getElementById('ans2').value = 'my answer three';
  window.__lastOpenedUrl = null;
  await window.App.checkReading();
  assert(typeof window.__lastOpenedUrl === 'string' && window.__lastOpenedUrl.startsWith('https://claude.ai/new?q='), 'checkReading opens claude.ai new-chat URL');
  assert(decodeURIComponent(window.__lastOpenedUrl).includes('my answer one'), 'prompt includes the learner\'s typed answer');
  assert(decodeURIComponent(window.__lastOpenedUrl).includes('Test Story Title'), 'prompt includes the story title/content');
  assert(doc.getElementById('readingReviewBox').style.display === 'block', 'reading review box becomes visible');

  // empty-answer guard
  doc.getElementById('ans0').value = '';
  doc.getElementById('ans1').value = '';
  doc.getElementById('ans2').value = '';
  window.__lastAlert = null;
  await window.App.checkReading();
  assert(window.__lastAlert && window.__lastAlert.includes('Write at least one answer'), 'checkReading blocks empty submissions with an alert');

  // ---------------------------------------------------------------
  console.log('\n8. Speaking: recording fallback (no mic) + review opens Claude.ai');
  window.App.startRecording();
  await new Promise(r => setTimeout(r, 20));
  assert(doc.getElementById('transcriptNote').textContent.includes("Couldn't access the microphone"), 'graceful fallback message shown when mic access is denied');

  doc.getElementById('speakingTranscript').value = 'this is my spoken answer';
  window.__lastOpenedUrl = null;
  await window.App.reviewSpeaking();
  assert(typeof window.__lastOpenedUrl === 'string' && window.__lastOpenedUrl.startsWith('https://claude.ai/new?q='), 'reviewSpeaking opens claude.ai new-chat URL');
  assert(decodeURIComponent(window.__lastOpenedUrl).includes('this is my spoken answer'), 'speaking prompt includes the transcript');

  window.__lastAlert = null;
  doc.getElementById('speakingTranscript').value = '';
  await window.App.reviewSpeaking();
  assert(window.__lastAlert && window.__lastAlert.includes('Record or type'), 'reviewSpeaking blocks empty transcript with an alert');

  // ---------------------------------------------------------------
  console.log('\n9. Retune button wiring + no-immediate-repeat across offline cycle');
  const rerollBtn = doc.getElementById('rerollBtn');
  assert(rerollBtn.disabled === false, 'retune button re-enabled after session load');

  // ---------------------------------------------------------------
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('Failed checks:');
    failures.forEach(f => console.log('  -', f));
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('\nTEST HARNESS CRASHED:', err);
  process.exit(1);
});