import { Link } from 'react-router-dom';
import { Quote, Star } from 'lucide-react';
import TESTIMONIALS from '../data/testimonials.json';
import { useT } from '../i18n/index.jsx';

// Shop owners' own words, exactly as they sent them (not translated), from data/testimonials.json (the server puts
// the same quotes in the page HTML for search engines). Add an owner only with a message they actually sent and
// agreed to show: { quote, store, slug, stars } for a named store, or { quote, whoKey } for an owner who stays unnamed.

export default function Testimonials() {
  const t = useT();
  return (
    <section className="bg-emerald-50/60 py-16" aria-labelledby="testimonials">
      <div className="mx-auto max-w-6xl px-4">
        <h2 id="testimonials" className="text-center text-3xl font-extrabold">{t('landing.testimonials.title')}</h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-stone-600">{t('landing.testimonials.subtitle')}</p>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {TESTIMONIALS.map((x) => (
            <figure key={x.quote} className="card flex flex-col p-6">
              <Quote size={28} className="text-brand/30" aria-hidden="true" />
              {x.stars > 0 && (
                <p className="mt-2 flex gap-0.5" role="img" aria-label={t('landing.testimonials.stars', { count: x.stars })}>
                  {Array.from({ length: x.stars }, (_, i) => (
                    <Star key={i} size={16} className="fill-amber-400 text-amber-400" aria-hidden="true" />
                  ))}
                </p>
              )}
              <blockquote className="mt-3 flex-1 text-stone-700" lang="en">“{x.quote}”</blockquote>
              <figcaption className="mt-4 text-sm">
                {x.store ? (
                  <>
                    <span className="font-bold">{x.store}</span>
                    <span className="text-stone-500"> · {t('landing.testimonials.owner')}</span>
                    {x.slug && (
                      <Link to={`/s/${x.slug}`} className="ms-2 font-semibold text-brand">{t('landing.testimonials.visit')}</Link>
                    )}
                  </>
                ) : (
                  <span className="font-semibold text-stone-600">{t(x.whoKey)}</span>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
