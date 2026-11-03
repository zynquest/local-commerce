import { useState } from 'react';
import { Play } from 'lucide-react';
import { useT } from '../i18n/index.jsx';

// Explainer videos on YouTube. Desktop shows the landscape video (owners and shoppers together);
// phones show the portrait Short for the chosen audience.
const VIDEOS = {
  en: { landscape: '6V4LcMU4i3w', owners: 'Z3JJrPjGVxU', shoppers: 'Ebm18J2tfwA' },
  hi: { landscape: '-llCKOt2klM', owners: '7ldJzoU0mPs', shoppers: 'ryK1uQUef4o' },
};
// Language names stay in their own script, whatever the site language.
const LANGS = [['en', 'English', 'en'], ['hi', 'हिन्दी', 'hi']];
const AUDIENCES = ['owners', 'shoppers'];

/**
 * Lightweight YouTube player: only a lazy thumbnail until it's tapped, then the youtube-nocookie iframe,
 * so the page never waits on YouTube's scripts.
 */
function LiteYouTube({ id, title, portrait }) {
  const t = useT();
  const [playing, setPlaying] = useState(false);
  // Shorts' hqdefault is 4:3 with the portrait frame in the middle, so object-cover crops it to the video itself.
  const [thumb, setThumb] = useState(portrait ? 'hqdefault' : 'maxresdefault');
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-stone-900 shadow-lg ${portrait ? 'aspect-[9/16]' : 'aspect-video'}`}>
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`}
          title={title}
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} className="group absolute inset-0 h-full w-full" aria-label={t('landing.video.play', { title })}>
          <img
            src={`https://i.ytimg.com/vi/${id}/${thumb}.jpg`}
            onError={() => setThumb('hqdefault')}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <span className="absolute inset-0 bg-black/10 transition group-hover:bg-black/20" />
          <span className="absolute top-1/2 left-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-rose-600 text-white shadow-xl transition group-hover:scale-110">
            <Play size={30} className="ms-1 fill-white" />
          </span>
        </button>
      )}
    </div>
  );
}

function Toggle({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full border border-stone-200 bg-white p-1 text-sm font-semibold shadow-sm">
      {options.map(([key, text, lang]) => (
        <button
          key={key}
          type="button"
          lang={lang}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`rounded-full px-4 py-1.5 transition ${value === key ? 'bg-brand text-white' : 'text-stone-600 hover:text-brand'}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export default function HomeVideos() {
  const t = useT();
  const [lang, setLang] = useState('en');
  const [audience, setAudience] = useState('owners');
  const ids = VIDEOS[lang];

  return (
    <section className="mx-auto max-w-6xl px-4 py-16" aria-labelledby="videos">
      <h2 id="videos" className="text-center text-3xl font-extrabold">{t('landing.video.title')}</h2>
      <p className="mx-auto mt-2 max-w-2xl text-center text-stone-600">{t('landing.video.subtitle')}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Toggle label={t('landing.video.language')} options={LANGS} value={lang} onChange={setLang} />
        <div className="md:hidden">
          <Toggle
            label={t('landing.video.audience')}
            options={AUDIENCES.map((a) => [a, t(`landing.video.${a}`)])}
            value={audience}
            onChange={setAudience}
          />
        </div>
      </div>
      {/* Keyed by video, so switching language or audience goes back to the thumbnail. */}
      <div className="mx-auto mt-8 hidden max-w-4xl md:block">
        <LiteYouTube key={ids.landscape} id={ids.landscape} title={t('landing.video.title')} />
      </div>
      <div className="mx-auto mt-8 w-full max-w-[300px] md:hidden">
        <LiteYouTube key={ids[audience]} id={ids[audience]} title={t(`landing.video.${audience}`)} portrait />
      </div>
    </section>
  );
}
