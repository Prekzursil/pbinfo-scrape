import { useEffect, useState } from 'react';

import type { ProblemDetailPayload } from '../../../main/library-detail-repository.js';
import { highlightCode, type SupportedTheme } from './highlighter.js';
import { SanitizedHtml } from './SanitizedHtml.js';

export interface OfficialSourceTabProps {
  readonly officialSource: ProblemDetailPayload['officialSource'];
  readonly theme: SupportedTheme;
}

const BANNERS: Record<string, string> = {
  'restricted-upstream':
    'Solve this problem for 100 pt to unlock the official source on pbinfo.ro.',
  'not-available-upstream':
    "pbinfo.ro doesn't publish an official source for this problem.",
  'not-captured-yet':
    "We haven't archived this yet — run Operator → Run full refresh to fetch it.",
};

export function OfficialSourceTab({
  officialSource,
  theme,
}: OfficialSourceTabProps) {
  const languages = officialSource.bodies
    ? Object.keys(officialSource.bodies)
    : [];
  const [activeLang, setActiveLang] = useState<string | undefined>(
    languages[0],
  );
  const [html, setHtml] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!activeLang || !officialSource.bodies) return;
    const body = officialSource.bodies[activeLang];
    if (!body) return;
    let cancelled = false;
    void highlightCode(body.body, activeLang, theme).then((rendered) => {
      if (!cancelled) setHtml(rendered);
    });
    return () => {
      cancelled = true;
    };
  }, [activeLang, officialSource.bodies, theme]);

  if (!officialSource.bodies || languages.length === 0) {
    const banner =
      BANNERS[officialSource.availability] ??
      'Official source unavailable for this problem.';
    return (
      <section className="official-tab">
        <p className="pac-banner">{banner}</p>
      </section>
    );
  }

  return (
    <section className="official-tab">
      <div role="tablist" className="official-tab__lang-switcher">
        {languages.map((lang) => (
          <button
            key={lang}
            type="button"
            role="tab"
            aria-selected={activeLang === lang}
            className={`pac-chip${activeLang === lang ? ' pac-chip--on' : ''}`}
            onClick={() => setActiveLang(lang)}
          >
            {lang}
          </button>
        ))}
      </div>
      {html && (
        <SanitizedHtml html={html} className="official-tab__code" />
      )}
    </section>
  );
}
