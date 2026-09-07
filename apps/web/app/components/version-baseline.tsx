import Link from 'next/link';
import { versionBaselineLabel, type VersionBaseline } from '@prototype-hub/contracts';

export function VersionBaselineInfo({ version }: { version: VersionBaseline }) {
  const text = versionBaselineLabel(version);
  return version.baseVersionId
    ? <Link href={`/versions/${version.baseVersionId}`} onClick={event => event.stopPropagation()}>{text}</Link>
    : <span>{text}</span>;
}
