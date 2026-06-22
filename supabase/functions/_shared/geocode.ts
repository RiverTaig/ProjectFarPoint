type Coordinate = [number, number] | [number, number, number];

type StartLocation = {
  city: string | null;
  state: string | null;
  province: string | null;
  country: string | null;
  continent: string | null;
};

const countryNamesByCode: Record<string, string> = {
  CA: 'Canada',
  CAN: 'Canada',
  US: 'United States',
  USA: 'United States',
  NZ: 'New Zealand',
  NZL: 'New Zealand',
};

const alpha3ToAlpha2CountryCodes: Record<string, string> = {
  ABW: 'AW', AFG: 'AF', AGO: 'AO', AIA: 'AI', ALA: 'AX', ALB: 'AL', AND: 'AD',
  ARE: 'AE', ARG: 'AR', ARM: 'AM', ASM: 'AS', ATA: 'AQ', ATF: 'TF', ATG: 'AG',
  AUS: 'AU', AUT: 'AT', AZE: 'AZ', BDI: 'BI', BEL: 'BE', BEN: 'BJ', BES: 'BQ',
  BFA: 'BF', BGD: 'BD', BGR: 'BG', BHR: 'BH', BHS: 'BS', BIH: 'BA', BLM: 'BL',
  BLR: 'BY', BLZ: 'BZ', BMU: 'BM', BOL: 'BO', BRA: 'BR', BRB: 'BB', BRN: 'BN',
  BTN: 'BT', BVT: 'BV', BWA: 'BW', CAF: 'CF', CAN: 'CA', CCK: 'CC', CHE: 'CH',
  CHL: 'CL', CHN: 'CN', CIV: 'CI', CMR: 'CM', COD: 'CD', COG: 'CG', COK: 'CK',
  COL: 'CO', COM: 'KM', CPV: 'CV', CRI: 'CR', CUB: 'CU', CUW: 'CW', CXR: 'CX',
  CYM: 'KY', CYP: 'CY', CZE: 'CZ', DEU: 'DE', DJI: 'DJ', DMA: 'DM', DNK: 'DK',
  DOM: 'DO', DZA: 'DZ', ECU: 'EC', EGY: 'EG', ERI: 'ER', ESH: 'EH', ESP: 'ES',
  EST: 'EE', ETH: 'ET', FIN: 'FI', FJI: 'FJ', FLK: 'FK', FRA: 'FR', FRO: 'FO',
  FSM: 'FM', GAB: 'GA', GBR: 'GB', GEO: 'GE', GGY: 'GG', GHA: 'GH', GIB: 'GI',
  GIN: 'GN', GLP: 'GP', GMB: 'GM', GNB: 'GW', GNQ: 'GQ', GRC: 'GR', GRD: 'GD',
  GRL: 'GL', GTM: 'GT', GUF: 'GF', GUM: 'GU', GUY: 'GY', HKG: 'HK', HMD: 'HM',
  HND: 'HN', HRV: 'HR', HTI: 'HT', HUN: 'HU', IDN: 'ID', IMN: 'IM', IND: 'IN',
  IOT: 'IO', IRL: 'IE', IRN: 'IR', IRQ: 'IQ', ISL: 'IS', ISR: 'IL', ITA: 'IT',
  JAM: 'JM', JEY: 'JE', JOR: 'JO', JPN: 'JP', KAZ: 'KZ', KEN: 'KE', KGZ: 'KG',
  KHM: 'KH', KIR: 'KI', KNA: 'KN', KOR: 'KR', KWT: 'KW', LAO: 'LA', LBN: 'LB',
  LBR: 'LR', LBY: 'LY', LCA: 'LC', LIE: 'LI', LKA: 'LK', LSO: 'LS', LTU: 'LT',
  LUX: 'LU', LVA: 'LV', MAC: 'MO', MAF: 'MF', MAR: 'MA', MCO: 'MC', MDA: 'MD',
  MDG: 'MG', MDV: 'MV', MEX: 'MX', MHL: 'MH', MKD: 'MK', MLI: 'ML', MLT: 'MT',
  MMR: 'MM', MNE: 'ME', MNG: 'MN', MNP: 'MP', MOZ: 'MZ', MRT: 'MR', MSR: 'MS',
  MTQ: 'MQ', MUS: 'MU', MWI: 'MW', MYS: 'MY', MYT: 'YT', NAM: 'NA', NCL: 'NC',
  NER: 'NE', NFK: 'NF', NGA: 'NG', NIC: 'NI', NIU: 'NU', NLD: 'NL', NOR: 'NO',
  NPL: 'NP', NRU: 'NR', NZL: 'NZ', OMN: 'OM', PAK: 'PK', PAN: 'PA', PCN: 'PN',
  PER: 'PE', PHL: 'PH', PLW: 'PW', PNG: 'PG', POL: 'PL', PRI: 'PR', PRK: 'KP',
  PRT: 'PT', PRY: 'PY', PSE: 'PS', PYF: 'PF', QAT: 'QA', REU: 'RE', ROU: 'RO',
  RUS: 'RU', RWA: 'RW', SAU: 'SA', SDN: 'SD', SEN: 'SN', SGP: 'SG', SGS: 'GS',
  SHN: 'SH', SJM: 'SJ', SLB: 'SB', SLE: 'SL', SLV: 'SV', SMR: 'SM', SOM: 'SO',
  SPM: 'PM', SRB: 'RS', SSD: 'SS', STP: 'ST', SUR: 'SR', SVK: 'SK', SVN: 'SI',
  SWE: 'SE', SWZ: 'SZ', SXM: 'SX', SYC: 'SC', SYR: 'SY', TCA: 'TC', TCD: 'TD',
  TGO: 'TG', THA: 'TH', TJK: 'TJ', TKL: 'TK', TKM: 'TM', TLS: 'TL', TON: 'TO',
  TTO: 'TT', TUN: 'TN', TUR: 'TR', TUV: 'TV', TWN: 'TW', TZA: 'TZ', UGA: 'UG',
  UKR: 'UA', UMI: 'UM', URY: 'UY', USA: 'US', UZB: 'UZ', VAT: 'VA', VCT: 'VC',
  VEN: 'VE', VGB: 'VG', VIR: 'VI', VNM: 'VN', VUT: 'VU', WLF: 'WF', WSM: 'WS',
  YEM: 'YE', ZAF: 'ZA', ZMB: 'ZM', ZWE: 'ZW',
};

const continentsByCountryCode: Record<string, string> = {
  AD: 'Europe', AE: 'Asia', AF: 'Asia', AG: 'North America', AI: 'North America',
  AL: 'Europe', AM: 'Asia', AO: 'Africa', AQ: 'Antarctica', AR: 'South America',
  AS: 'Oceania', AT: 'Europe', AU: 'Oceania', AW: 'North America', AX: 'Europe',
  AZ: 'Asia', BA: 'Europe', BB: 'North America', BD: 'Asia', BE: 'Europe',
  BF: 'Africa', BG: 'Europe', BH: 'Asia', BI: 'Africa', BJ: 'Africa',
  BL: 'North America', BM: 'North America', BN: 'Asia', BO: 'South America',
  BQ: 'North America', BR: 'South America', BS: 'North America', BT: 'Asia',
  BV: 'Antarctica', BW: 'Africa', BY: 'Europe', BZ: 'North America', CA: 'North America',
  CC: 'Asia', CD: 'Africa', CF: 'Africa', CG: 'Africa', CH: 'Europe',
  CI: 'Africa', CK: 'Oceania', CL: 'South America', CM: 'Africa', CN: 'Asia',
  CO: 'South America', CR: 'North America', CU: 'North America', CV: 'Africa',
  CW: 'North America', CX: 'Asia', CY: 'Asia', CZ: 'Europe', DE: 'Europe',
  DJ: 'Africa', DK: 'Europe', DM: 'North America', DO: 'North America', DZ: 'Africa',
  EC: 'South America', EE: 'Europe', EG: 'Africa', EH: 'Africa', ER: 'Africa',
  ES: 'Europe', ET: 'Africa', FI: 'Europe', FJ: 'Oceania', FK: 'South America',
  FM: 'Oceania', FO: 'Europe', FR: 'Europe', GA: 'Africa', GB: 'Europe',
  GD: 'North America', GE: 'Asia', GF: 'South America', GG: 'Europe', GH: 'Africa',
  GI: 'Europe', GL: 'North America', GM: 'Africa', GN: 'Africa', GP: 'North America',
  GQ: 'Africa', GR: 'Europe', GS: 'Antarctica', GT: 'North America', GU: 'Oceania',
  GW: 'Africa', GY: 'South America', HK: 'Asia', HM: 'Antarctica', HN: 'North America',
  HR: 'Europe', HT: 'North America', HU: 'Europe', ID: 'Asia', IE: 'Europe',
  IL: 'Asia', IM: 'Europe', IN: 'Asia', IO: 'Asia', IQ: 'Asia',
  IR: 'Asia', IS: 'Europe', IT: 'Europe', JE: 'Europe', JM: 'North America',
  JO: 'Asia', JP: 'Asia', KE: 'Africa', KG: 'Asia', KH: 'Asia',
  KI: 'Oceania', KM: 'Africa', KN: 'North America', KP: 'Asia', KR: 'Asia',
  KW: 'Asia', KY: 'North America', KZ: 'Asia', LA: 'Asia', LB: 'Asia',
  LC: 'North America', LI: 'Europe', LK: 'Asia', LR: 'Africa', LS: 'Africa',
  LT: 'Europe', LU: 'Europe', LV: 'Europe', LY: 'Africa', MA: 'Africa',
  MC: 'Europe', MD: 'Europe', ME: 'Europe', MF: 'North America', MG: 'Africa',
  MH: 'Oceania', MK: 'Europe', ML: 'Africa', MM: 'Asia', MN: 'Asia',
  MO: 'Asia', MP: 'Oceania', MQ: 'North America', MR: 'Africa', MS: 'North America',
  MT: 'Europe', MU: 'Africa', MV: 'Asia', MW: 'Africa', MX: 'North America',
  MY: 'Asia', MZ: 'Africa', NA: 'Africa', NC: 'Oceania', NE: 'Africa',
  NF: 'Oceania', NG: 'Africa', NI: 'North America', NL: 'Europe', NO: 'Europe',
  NP: 'Asia', NR: 'Oceania', NU: 'Oceania', NZ: 'Oceania', OM: 'Asia',
  PA: 'North America', PE: 'South America', PF: 'Oceania', PG: 'Oceania', PH: 'Asia',
  PK: 'Asia', PL: 'Europe', PM: 'North America', PN: 'Oceania', PR: 'North America',
  PS: 'Asia', PT: 'Europe', PW: 'Oceania', PY: 'South America', QA: 'Asia',
  RE: 'Africa', RO: 'Europe', RS: 'Europe', RU: 'Europe', RW: 'Africa',
  SA: 'Asia', SB: 'Oceania', SC: 'Africa', SD: 'Africa', SE: 'Europe',
  SG: 'Asia', SH: 'Africa', SI: 'Europe', SJ: 'Europe', SK: 'Europe',
  SL: 'Africa', SM: 'Europe', SN: 'Africa', SO: 'Africa', SR: 'South America',
  SS: 'Africa', ST: 'Africa', SV: 'North America', SX: 'North America', SY: 'Asia',
  SZ: 'Africa', TC: 'North America', TD: 'Africa', TF: 'Antarctica', TG: 'Africa',
  TH: 'Asia', TJ: 'Asia', TK: 'Oceania', TL: 'Asia', TM: 'Asia',
  TN: 'Africa', TO: 'Oceania', TR: 'Asia', TT: 'North America', TV: 'Oceania',
  TW: 'Asia', TZ: 'Africa', UA: 'Europe', UG: 'Africa', UM: 'Oceania',
  US: 'North America', UY: 'South America', UZ: 'Asia', VA: 'Europe', VC: 'North America',
  VE: 'South America', VG: 'North America', VI: 'North America', VN: 'Asia', VU: 'Oceania',
  WF: 'Oceania', WS: 'Oceania', YE: 'Asia', YT: 'Africa', ZA: 'Africa',
  ZM: 'Africa', ZW: 'Africa',
};

function cleanText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanCountryCode(code: unknown) {
  const cleanCode = cleanText(code)?.toUpperCase();

  return cleanCode?.length === 3
    ? alpha3ToAlpha2CountryCodes[cleanCode] ?? cleanCode
    : cleanCode ?? null;
}

function countryNameFromCode(code: unknown) {
  const cleanCode = cleanCountryCode(code);

  if (!cleanCode) {
    return null;
  }

  if (countryNamesByCode[cleanCode]) {
    return countryNamesByCode[cleanCode];
  }

  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(cleanCode) ?? cleanCode;
  } catch {
    return cleanCode;
  }
}

function continentFromCountryCode(code: unknown) {
  const cleanCode = cleanCountryCode(code);

  return cleanCode ? continentsByCountryCode[cleanCode] ?? null : null;
}

export async function reverseGeocodeStartLocation(
  coordinate: Coordinate | undefined,
): Promise<StartLocation> {
  if (!coordinate) {
    return {
      city: null,
      state: null,
      province: null,
      country: null,
      continent: null,
    };
  }

  const [longitude, latitude] = coordinate;
  const geocodeUrl = new URL(
    'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode',
  );

  geocodeUrl.searchParams.set('f', 'json');
  geocodeUrl.searchParams.set('langCode', 'en');
  geocodeUrl.searchParams.set('location', `${longitude},${latitude}`);

  try {
    const response = await fetch(geocodeUrl);

    if (!response.ok) {
      throw new Error(`Reverse geocode returned ${response.status}.`);
    }

    const data = await response.json();
    const address = data?.address ?? {};
    const countryCode = cleanCountryCode(address.CountryCode);
    const country = cleanText(address.CntryName) ?? countryNameFromCode(address.CountryCode);
    const region = cleanText(address.Region);

    return {
      city:
        cleanText(address.City) ??
        cleanText(address.District) ??
        cleanText(address.Subregion) ??
        cleanText(address.Region),
      state: country === 'Canada' ? null : region,
      province: country === 'Canada' ? region : null,
      country,
      continent: continentFromCountryCode(countryCode),
    };
  } catch (error) {
    console.error('Could not reverse geocode start location.', error);

    return {
      city: null,
      state: null,
      province: null,
      country: null,
      continent: null,
    };
  }
}
