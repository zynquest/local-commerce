import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import SmartImage from './SmartImage.jsx';
import { useT } from '../i18n/index.jsx';

/** Touch-swipe carousel built on CSS scroll-snap, with dot indicators. */
export default function ImageCarousel({ images, alt, width = 600, className = '', showArrows = false, eager = false, hint = '' }) {
  const t = useT();
  const ref = useRef(null);
  const [index, setIndex] = useState(0);
  const list = images?.length ? images : [''];

  const onScroll = () => {
    const el = ref.current;
    if (el) setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };
  const go = (i, e) => {
    e?.preventDefault();
    e?.stopPropagation();
    const el = ref.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <div className={`relative ${className}`}>
      <div
        ref={ref}
        onScroll={onScroll}
        className="no-scrollbar flex h-full w-full snap-x snap-mandatory overflow-x-auto"
      >
        {list.map((src, i) => (
          <SmartImage
            key={i}
            src={src}
            alt={alt}
            hint={hint}
            width={width}
            eager={eager && i === 0}
            className="h-full w-full flex-none snap-center object-cover"
            draggable={false}
          />
        ))}
      </div>
      {list.length > 1 && (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {list.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === index ? 'w-4 bg-stone-800' : 'w-1.5 bg-stone-800/30'}`}
              />
            ))}
          </div>
          {showArrows && (
            <>
              <button
                aria-label={t('product.prevImage')}
                onClick={(e) => go(Math.max(0, index - 1), e)}
                className="absolute top-1/2 start-2 hidden -translate-y-1/2 rounded-full bg-white/80 p-1.5 shadow sm:block"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                aria-label={t('product.nextImage')}
                onClick={(e) => go(Math.min(list.length - 1, index + 1), e)}
                className="absolute top-1/2 end-2 hidden -translate-y-1/2 rounded-full bg-white/80 p-1.5 shadow sm:block"
              >
                <ChevronRight size={18} />
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
