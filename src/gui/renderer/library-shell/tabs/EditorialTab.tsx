import type { ProblemDetailPayload } from '../../../main/library-detail-repository.js';
import { SanitizedHtml } from './SanitizedHtml.js';

export interface EditorialTabProps {
  readonly editorial: ProblemDetailPayload['editorial'];
}

const BANNERS: Record<string, string> = {
  visible:
    "The editorial is marked visible on pbinfo.ro, but the raw HTML page isn't present in this archive snapshot (raw pages are often omitted to keep the archive small). Run Operator → Run full refresh to re-capture it, or open the problem on pbinfo.ro directly.",
  restricted:
    'Editorial is visible to you on pbinfo.ro after your first submission — even an incorrect one.',
  hidden: 'pbinfo.ro has not published an editorial for this problem.',
  unknown:
    "We don't yet know whether an editorial exists for this problem. Run Operator → Run full refresh.",
};

export function EditorialTab({ editorial }: EditorialTabProps) {
  if (editorial.availability === 'visible' && editorial.htmlBody) {
    return (
      <section className="editorial-tab">
        <SanitizedHtml
          html={editorial.htmlBody}
          className="editorial-tab__body"
        />
      </section>
    );
  }
  const bannerText =
    BANNERS[editorial.availability] ??
    `Editorial availability: ${editorial.availability}.`;
  return (
    <section className="editorial-tab">
      <p className="pac-banner">{bannerText}</p>
    </section>
  );
}
