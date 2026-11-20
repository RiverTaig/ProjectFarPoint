export function parseTrailGpx(xml: string, filename: string) {
  const match = /^FPT_(\d+)\.gpx$/i.exec(filename);
  const segment = match?.[1].replace(/^0+/, '');
  if (!segment || segment.length > 13) throw new Error('Name the file FPT_<positive segment number>.gpx.');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('GPX files with document types or entities are not supported.');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'gpx') throw new Error('The file is not valid GPX XML.');
  const root = document.documentElement;
  const children = (node: Element, name: string) => Array.from(node.children).filter((child) => child.localName === name);
  const sections = [...Array.from(root.getElementsByTagNameNS('*', 'trkseg')), ...children(root, 'rte')];
  let vertices = 0;
  const coordinates = sections.map((section) => {
    const points: number[][] = [];
    for (const point of Array.from(section.children).filter((child) => ['trkpt', 'rtept'].includes(child.localName))) {
      const longitude = point.getAttribute('lon'), latitude = point.getAttribute('lat');
      const lon = Number(longitude), lat = Number(latitude);
      if (!longitude?.trim() || !latitude?.trim() || !Number.isFinite(lon) || !Number.isFinite(lat)
        || Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new Error('The GPX contains an invalid longitude or latitude.');
      const previous = points.at(-1);
      if (!previous || previous[0] !== lon || previous[1] !== lat) { points.push([lon, lat]); vertices++; }
      if (vertices > 250000) throw new Error('Choose a segment with no more than 250,000 points.');
    }
    if (points.length < 2) throw new Error('Each track or route section needs at least two distinct points.');
    return points;
  });
  if (!coordinates.length) throw new Error('The GPX has no track or route sections.');
  const metadata = children(root, 'metadata')[0] ?? root;
  const text = (node: Element, name: string, fallback: string) => children(node, name)[0]?.textContent || fallback;
  const copyright = children(metadata, 'copyright')[0];
  const code = `FPT${segment}`;
  const feature = { type: 'Feature', properties: {
    name: text(metadata, 'name', code), source: filename, code,
    description: text(metadata, 'desc', ''),
    copyright: copyright ? [copyright.getAttribute('author'), text(copyright, 'year', '')].filter(Boolean).join(' ') || 'Source GPX' : 'Source GPX',
    license: copyright ? text(copyright, 'license', 'See source GPX') : 'See source GPX',
  }, geometry: { type: 'MultiLineString', coordinates } };
  return { feature, vertices, sections: coordinates.length, code };
}
