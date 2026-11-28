// GENERATED: paste this entire file into the strava-import-activity Edge Function editor.
// Do not paste into SQL Editor. Regenerate with node scripts/prepare-offline-function.mjs.
// @ts-nocheck -- generated JavaScript in a .ts dashboard entrypoint; source is typechecked separately.

// supabase/functions/_shared/cors.ts
function corsHeaders(origin) {
  const allowedOrigins = (Deno.env.get("APP_ORIGINS") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? "*";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin"
  };
}

// supabase/functions/_shared/strava.ts
import { createClient } from "npm:@supabase/supabase-js@2";
async function getFreshStravaConnection(userId) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stravaClientId = Deno.env.get("STRAVA_CLIENT_ID");
  const stravaClientSecret = Deno.env.get("STRAVA_CLIENT_SECRET");
  if (!supabaseUrl || !supabaseServiceRoleKey || !stravaClientId || !stravaClientSecret) {
    throw new Error("Strava integration is not configured.");
  }
  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey);
  const { data: connection, error } = await serviceClient.from("strava_connections").select("user_id,athlete_id,access_token,refresh_token,expires_at").eq("user_id", userId).maybeSingle();
  if (error) {
    throw error;
  }
  if (!connection) {
    throw new Error("Strava is not connected.");
  }
  if (new Date(connection.expires_at).getTime() > Date.now() + 6e4) {
    return { connection, serviceClient };
  }
  const refreshResponse = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: stravaClientId,
      client_secret: stravaClientSecret,
      grant_type: "refresh_token",
      refresh_token: connection.refresh_token
    })
  });
  if (!refreshResponse.ok) {
    throw new Error("Could not refresh Strava access.");
  }
  const refreshData = await refreshResponse.json();
  const refreshedConnection = {
    ...connection,
    access_token: refreshData.access_token,
    refresh_token: refreshData.refresh_token,
    expires_at: new Date(refreshData.expires_at * 1e3).toISOString()
  };
  const { error: updateError } = await serviceClient.from("strava_connections").update({
    access_token: refreshedConnection.access_token,
    refresh_token: refreshedConnection.refresh_token,
    expires_at: refreshedConnection.expires_at,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  }).eq("user_id", userId);
  if (updateError) {
    throw updateError;
  }
  return { connection: refreshedConnection, serviceClient };
}
async function getAuthorizedUser(request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase is not configured.");
  }
  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: request.headers.get("authorization") ?? ""
      }
    }
  });
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) {
    throw new Error("You must be signed in.");
  }
  if (data.user.email?.toLowerCase() !== "rivermadsen23@gmail.com") {
    throw new Error("Only the Project Far Point owner can import activities.");
  }
  return data.user;
}

// supabase/functions/_shared/geocode.ts
var countryNamesByCode = {
  CA: "Canada",
  CAN: "Canada",
  US: "United States",
  USA: "United States",
  NZ: "New Zealand",
  NZL: "New Zealand"
};
var alpha3ToAlpha2CountryCodes = {
  ABW: "AW",
  AFG: "AF",
  AGO: "AO",
  AIA: "AI",
  ALA: "AX",
  ALB: "AL",
  AND: "AD",
  ARE: "AE",
  ARG: "AR",
  ARM: "AM",
  ASM: "AS",
  ATA: "AQ",
  ATF: "TF",
  ATG: "AG",
  AUS: "AU",
  AUT: "AT",
  AZE: "AZ",
  BDI: "BI",
  BEL: "BE",
  BEN: "BJ",
  BES: "BQ",
  BFA: "BF",
  BGD: "BD",
  BGR: "BG",
  BHR: "BH",
  BHS: "BS",
  BIH: "BA",
  BLM: "BL",
  BLR: "BY",
  BLZ: "BZ",
  BMU: "BM",
  BOL: "BO",
  BRA: "BR",
  BRB: "BB",
  BRN: "BN",
  BTN: "BT",
  BVT: "BV",
  BWA: "BW",
  CAF: "CF",
  CAN: "CA",
  CCK: "CC",
  CHE: "CH",
  CHL: "CL",
  CHN: "CN",
  CIV: "CI",
  CMR: "CM",
  COD: "CD",
  COG: "CG",
  COK: "CK",
  COL: "CO",
  COM: "KM",
  CPV: "CV",
  CRI: "CR",
  CUB: "CU",
  CUW: "CW",
  CXR: "CX",
  CYM: "KY",
  CYP: "CY",
  CZE: "CZ",
  DEU: "DE",
  DJI: "DJ",
  DMA: "DM",
  DNK: "DK",
  DOM: "DO",
  DZA: "DZ",
  ECU: "EC",
  EGY: "EG",
  ERI: "ER",
  ESH: "EH",
  ESP: "ES",
  EST: "EE",
  ETH: "ET",
  FIN: "FI",
  FJI: "FJ",
  FLK: "FK",
  FRA: "FR",
  FRO: "FO",
  FSM: "FM",
  GAB: "GA",
  GBR: "GB",
  GEO: "GE",
  GGY: "GG",
  GHA: "GH",
  GIB: "GI",
  GIN: "GN",
  GLP: "GP",
  GMB: "GM",
  GNB: "GW",
  GNQ: "GQ",
  GRC: "GR",
  GRD: "GD",
  GRL: "GL",
  GTM: "GT",
  GUF: "GF",
  GUM: "GU",
  GUY: "GY",
  HKG: "HK",
  HMD: "HM",
  HND: "HN",
  HRV: "HR",
  HTI: "HT",
  HUN: "HU",
  IDN: "ID",
  IMN: "IM",
  IND: "IN",
  IOT: "IO",
  IRL: "IE",
  IRN: "IR",
  IRQ: "IQ",
  ISL: "IS",
  ISR: "IL",
  ITA: "IT",
  JAM: "JM",
  JEY: "JE",
  JOR: "JO",
  JPN: "JP",
  KAZ: "KZ",
  KEN: "KE",
  KGZ: "KG",
  KHM: "KH",
  KIR: "KI",
  KNA: "KN",
  KOR: "KR",
  KWT: "KW",
  LAO: "LA",
  LBN: "LB",
  LBR: "LR",
  LBY: "LY",
  LCA: "LC",
  LIE: "LI",
  LKA: "LK",
  LSO: "LS",
  LTU: "LT",
  LUX: "LU",
  LVA: "LV",
  MAC: "MO",
  MAF: "MF",
  MAR: "MA",
  MCO: "MC",
  MDA: "MD",
  MDG: "MG",
  MDV: "MV",
  MEX: "MX",
  MHL: "MH",
  MKD: "MK",
  MLI: "ML",
  MLT: "MT",
  MMR: "MM",
  MNE: "ME",
  MNG: "MN",
  MNP: "MP",
  MOZ: "MZ",
  MRT: "MR",
  MSR: "MS",
  MTQ: "MQ",
  MUS: "MU",
  MWI: "MW",
  MYS: "MY",
  MYT: "YT",
  NAM: "NA",
  NCL: "NC",
  NER: "NE",
  NFK: "NF",
  NGA: "NG",
  NIC: "NI",
  NIU: "NU",
  NLD: "NL",
  NOR: "NO",
  NPL: "NP",
  NRU: "NR",
  NZL: "NZ",
  OMN: "OM",
  PAK: "PK",
  PAN: "PA",
  PCN: "PN",
  PER: "PE",
  PHL: "PH",
  PLW: "PW",
  PNG: "PG",
  POL: "PL",
  PRI: "PR",
  PRK: "KP",
  PRT: "PT",
  PRY: "PY",
  PSE: "PS",
  PYF: "PF",
  QAT: "QA",
  REU: "RE",
  ROU: "RO",
  RUS: "RU",
  RWA: "RW",
  SAU: "SA",
  SDN: "SD",
  SEN: "SN",
  SGP: "SG",
  SGS: "GS",
  SHN: "SH",
  SJM: "SJ",
  SLB: "SB",
  SLE: "SL",
  SLV: "SV",
  SMR: "SM",
  SOM: "SO",
  SPM: "PM",
  SRB: "RS",
  SSD: "SS",
  STP: "ST",
  SUR: "SR",
  SVK: "SK",
  SVN: "SI",
  SWE: "SE",
  SWZ: "SZ",
  SXM: "SX",
  SYC: "SC",
  SYR: "SY",
  TCA: "TC",
  TCD: "TD",
  TGO: "TG",
  THA: "TH",
  TJK: "TJ",
  TKL: "TK",
  TKM: "TM",
  TLS: "TL",
  TON: "TO",
  TTO: "TT",
  TUN: "TN",
  TUR: "TR",
  TUV: "TV",
  TWN: "TW",
  TZA: "TZ",
  UGA: "UG",
  UKR: "UA",
  UMI: "UM",
  URY: "UY",
  USA: "US",
  UZB: "UZ",
  VAT: "VA",
  VCT: "VC",
  VEN: "VE",
  VGB: "VG",
  VIR: "VI",
  VNM: "VN",
  VUT: "VU",
  WLF: "WF",
  WSM: "WS",
  YEM: "YE",
  ZAF: "ZA",
  ZMB: "ZM",
  ZWE: "ZW"
};
var continentsByCountryCode = {
  AD: "Europe",
  AE: "Asia",
  AF: "Asia",
  AG: "North America",
  AI: "North America",
  AL: "Europe",
  AM: "Asia",
  AO: "Africa",
  AQ: "Antarctica",
  AR: "South America",
  AS: "Oceania",
  AT: "Europe",
  AU: "Oceania",
  AW: "North America",
  AX: "Europe",
  AZ: "Asia",
  BA: "Europe",
  BB: "North America",
  BD: "Asia",
  BE: "Europe",
  BF: "Africa",
  BG: "Europe",
  BH: "Asia",
  BI: "Africa",
  BJ: "Africa",
  BL: "North America",
  BM: "North America",
  BN: "Asia",
  BO: "South America",
  BQ: "North America",
  BR: "South America",
  BS: "North America",
  BT: "Asia",
  BV: "Antarctica",
  BW: "Africa",
  BY: "Europe",
  BZ: "North America",
  CA: "North America",
  CC: "Asia",
  CD: "Africa",
  CF: "Africa",
  CG: "Africa",
  CH: "Europe",
  CI: "Africa",
  CK: "Oceania",
  CL: "South America",
  CM: "Africa",
  CN: "Asia",
  CO: "South America",
  CR: "North America",
  CU: "North America",
  CV: "Africa",
  CW: "North America",
  CX: "Asia",
  CY: "Asia",
  CZ: "Europe",
  DE: "Europe",
  DJ: "Africa",
  DK: "Europe",
  DM: "North America",
  DO: "North America",
  DZ: "Africa",
  EC: "South America",
  EE: "Europe",
  EG: "Africa",
  EH: "Africa",
  ER: "Africa",
  ES: "Europe",
  ET: "Africa",
  FI: "Europe",
  FJ: "Oceania",
  FK: "South America",
  FM: "Oceania",
  FO: "Europe",
  FR: "Europe",
  GA: "Africa",
  GB: "Europe",
  GD: "North America",
  GE: "Asia",
  GF: "South America",
  GG: "Europe",
  GH: "Africa",
  GI: "Europe",
  GL: "North America",
  GM: "Africa",
  GN: "Africa",
  GP: "North America",
  GQ: "Africa",
  GR: "Europe",
  GS: "Antarctica",
  GT: "North America",
  GU: "Oceania",
  GW: "Africa",
  GY: "South America",
  HK: "Asia",
  HM: "Antarctica",
  HN: "North America",
  HR: "Europe",
  HT: "North America",
  HU: "Europe",
  ID: "Asia",
  IE: "Europe",
  IL: "Asia",
  IM: "Europe",
  IN: "Asia",
  IO: "Asia",
  IQ: "Asia",
  IR: "Asia",
  IS: "Europe",
  IT: "Europe",
  JE: "Europe",
  JM: "North America",
  JO: "Asia",
  JP: "Asia",
  KE: "Africa",
  KG: "Asia",
  KH: "Asia",
  KI: "Oceania",
  KM: "Africa",
  KN: "North America",
  KP: "Asia",
  KR: "Asia",
  KW: "Asia",
  KY: "North America",
  KZ: "Asia",
  LA: "Asia",
  LB: "Asia",
  LC: "North America",
  LI: "Europe",
  LK: "Asia",
  LR: "Africa",
  LS: "Africa",
  LT: "Europe",
  LU: "Europe",
  LV: "Europe",
  LY: "Africa",
  MA: "Africa",
  MC: "Europe",
  MD: "Europe",
  ME: "Europe",
  MF: "North America",
  MG: "Africa",
  MH: "Oceania",
  MK: "Europe",
  ML: "Africa",
  MM: "Asia",
  MN: "Asia",
  MO: "Asia",
  MP: "Oceania",
  MQ: "North America",
  MR: "Africa",
  MS: "North America",
  MT: "Europe",
  MU: "Africa",
  MV: "Asia",
  MW: "Africa",
  MX: "North America",
  MY: "Asia",
  MZ: "Africa",
  NA: "Africa",
  NC: "Oceania",
  NE: "Africa",
  NF: "Oceania",
  NG: "Africa",
  NI: "North America",
  NL: "Europe",
  NO: "Europe",
  NP: "Asia",
  NR: "Oceania",
  NU: "Oceania",
  NZ: "Oceania",
  OM: "Asia",
  PA: "North America",
  PE: "South America",
  PF: "Oceania",
  PG: "Oceania",
  PH: "Asia",
  PK: "Asia",
  PL: "Europe",
  PM: "North America",
  PN: "Oceania",
  PR: "North America",
  PS: "Asia",
  PT: "Europe",
  PW: "Oceania",
  PY: "South America",
  QA: "Asia",
  RE: "Africa",
  RO: "Europe",
  RS: "Europe",
  RU: "Europe",
  RW: "Africa",
  SA: "Asia",
  SB: "Oceania",
  SC: "Africa",
  SD: "Africa",
  SE: "Europe",
  SG: "Asia",
  SH: "Africa",
  SI: "Europe",
  SJ: "Europe",
  SK: "Europe",
  SL: "Africa",
  SM: "Europe",
  SN: "Africa",
  SO: "Africa",
  SR: "South America",
  SS: "Africa",
  ST: "Africa",
  SV: "North America",
  SX: "North America",
  SY: "Asia",
  SZ: "Africa",
  TC: "North America",
  TD: "Africa",
  TF: "Antarctica",
  TG: "Africa",
  TH: "Asia",
  TJ: "Asia",
  TK: "Oceania",
  TL: "Asia",
  TM: "Asia",
  TN: "Africa",
  TO: "Oceania",
  TR: "Asia",
  TT: "North America",
  TV: "Oceania",
  TW: "Asia",
  TZ: "Africa",
  UA: "Europe",
  UG: "Africa",
  UM: "Oceania",
  US: "North America",
  UY: "South America",
  UZ: "Asia",
  VA: "Europe",
  VC: "North America",
  VE: "South America",
  VG: "North America",
  VI: "North America",
  VN: "Asia",
  VU: "Oceania",
  WF: "Oceania",
  WS: "Oceania",
  YE: "Asia",
  YT: "Africa",
  ZA: "Africa",
  ZM: "Africa",
  ZW: "Africa"
};
function cleanText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function cleanCountryCode(code) {
  const cleanCode = cleanText(code)?.toUpperCase();
  return cleanCode?.length === 3 ? alpha3ToAlpha2CountryCodes[cleanCode] ?? cleanCode : cleanCode ?? null;
}
function countryNameFromCode(code) {
  const cleanCode = cleanCountryCode(code);
  if (!cleanCode) {
    return null;
  }
  if (countryNamesByCode[cleanCode]) {
    return countryNamesByCode[cleanCode];
  }
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(cleanCode) ?? cleanCode;
  } catch {
    return cleanCode;
  }
}
function continentFromCountryCode(code) {
  const cleanCode = cleanCountryCode(code);
  return cleanCode ? continentsByCountryCode[cleanCode] ?? null : null;
}
async function reverseGeocodeStartLocation(coordinate) {
  if (!coordinate) {
    return {
      city: null,
      state: null,
      province: null,
      country: null,
      continent: null
    };
  }
  const [longitude, latitude] = coordinate;
  const geocodeUrl = new URL(
    "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode"
  );
  geocodeUrl.searchParams.set("f", "json");
  geocodeUrl.searchParams.set("langCode", "en");
  geocodeUrl.searchParams.set("location", `${longitude},${latitude}`);
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
      city: cleanText(address.City) ?? cleanText(address.District) ?? cleanText(address.Subregion) ?? cleanText(address.Region),
      state: country === "Canada" ? null : region,
      province: country === "Canada" ? region : null,
      country,
      continent: continentFromCountryCode(countryCode)
    };
  } catch (error) {
    console.error("Could not reverse geocode start location.", error);
    return {
      city: null,
      state: null,
      province: null,
      country: null,
      continent: null
    };
  }
}

// supabase/functions/_shared/simplifyCoordinates.ts
var geometryTolerances = { low: 2e-4, medium: 2e-5, high: 5e-6 };
function segmentDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(
    1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared
  ));
  return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy);
}
function simplifyCoordinates(coordinates, tolerance) {
  if (coordinates.length <= 2) return coordinates;
  const keep = /* @__PURE__ */ new Set([0, coordinates.length - 1]);
  const pending = [[0, coordinates.length - 1]];
  while (pending.length) {
    const [start, end] = pending.pop();
    let farthest = -1;
    let distance = tolerance;
    for (let index = start + 1; index < end; index++) {
      const candidate = segmentDistance(coordinates[index], coordinates[start], coordinates[end]);
      if (candidate > distance) {
        distance = candidate;
        farthest = index;
      }
    }
    if (farthest !== -1) {
      keep.add(farthest);
      pending.push([start, farthest], [farthest, end]);
    }
  }
  return coordinates.filter((_, index) => keep.has(index));
}

// supabase/functions/strava-import-activity/index.ts
var maxWalkingSpeedMetersPerSecond = 4.5;
function cleanText2(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function cleanNumber(value) {
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}
function cleanPfpType(value) {
  if (value === "Voyager" || value === "Far Point Trail") {
    return value;
  }
  return null;
}
function cleanTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function distanceMeters(start, end) {
  const [lon1, lat1] = start;
  const [lon2, lat2] = end;
  const latDifference = Math.PI / 180 * (lat2 - lat1);
  const lonDifference = Math.PI / 180 * (lon2 - lon1);
  const lat1Radians = Math.PI / 180 * lat1;
  const lat2Radians = Math.PI / 180 * lat2;
  const haversine = Math.sin(latDifference / 2) ** 2 + Math.cos(lat1Radians) * Math.cos(lat2Radians) * Math.sin(lonDifference / 2) ** 2;
  return 2 * 63710088e-1 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function removeImpossibleSpeedSpikes(coordinates, timeData) {
  if (!timeData || coordinates.length < 3 || timeData.length !== coordinates.length) {
    return coordinates;
  }
  const cleanedCoordinates = [];
  for (let index = 0; index < coordinates.length; index += 1) {
    const previous = cleanedCoordinates[cleanedCoordinates.length - 1];
    const current = coordinates[index];
    const next = coordinates[index + 1];
    const previousTime = timeData[index - 1];
    const currentTime = timeData[index];
    const nextTime = timeData[index + 1];
    if (previous && next && isFiniteNumber(previousTime) && isFiniteNumber(currentTime) && isFiniteNumber(nextTime)) {
      const previousSeconds = currentTime - previousTime;
      const nextSeconds = nextTime - currentTime;
      const skipSeconds = nextTime - previousTime;
      const previousDistance = distanceMeters(previous, current);
      const nextDistance = distanceMeters(current, next);
      const skipDistance = distanceMeters(previous, next);
      const previousSpeed = previousSeconds > 0 ? previousDistance / previousSeconds : 0;
      const nextSpeed = nextSeconds > 0 ? nextDistance / nextSeconds : 0;
      const skipSpeed = skipSeconds > 0 ? skipDistance / skipSeconds : 0;
      if (previousSpeed > maxWalkingSpeedMetersPerSecond && nextSpeed > maxWalkingSpeedMetersPerSecond && skipSpeed <= maxWalkingSpeedMetersPerSecond) {
        continue;
      }
    }
    cleanedCoordinates.push(current);
  }
  return cleanedCoordinates;
}
Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers });
  }
  try {
    if (request.method !== "POST") {
      return Response.json(
        { error: "Method not allowed." },
        { status: 405, headers }
      );
    }
    const user = await getAuthorizedUser(request);
    const { activityId, metadata = {} } = await request.json();
    if (!activityId) {
      return Response.json(
        { error: "Activity ID is required." },
        { status: 400, headers }
      );
    }
    const { connection, serviceClient } = await getFreshStravaConnection(user.id);
    const activityResponse = await fetch(
      `https://www.strava.com/api/v3/activities/${activityId}`,
      {
        headers: {
          Authorization: `Bearer ${connection.access_token}`
        }
      }
    );
    if (!activityResponse.ok) {
      throw new Error("Could not load Strava activity details.");
    }
    const activity = await activityResponse.json();
    const pfpType = cleanPfpType(metadata.pfpType);
    const startedAt = cleanTimestamp(metadata.startedAt) ?? activity.start_date;
    const streamsUrl = new URL(
      `https://www.strava.com/api/v3/activities/${activityId}/streams`
    );
    streamsUrl.searchParams.set("keys", "latlng,altitude,time");
    streamsUrl.searchParams.set("key_by_type", "true");
    const streamsResponse = await fetch(streamsUrl, {
      headers: {
        Authorization: `Bearer ${connection.access_token}`
      }
    });
    if (!streamsResponse.ok) {
      throw new Error("Could not load Strava activity geometry.");
    }
    const streams = await streamsResponse.json();
    const latLngData = streams.latlng?.data;
    const altitudeData = streams.altitude?.data;
    const timeData = streams.time?.data;
    if (!latLngData?.length) {
      throw new Error("This activity does not include route geometry.");
    }
    const rawCoordinates = latLngData.map(([latitude, longitude], index) => {
      const altitude = altitudeData?.[index];
      return typeof altitude === "number" ? [longitude, latitude, altitude] : [longitude, latitude];
    });
    const coordinates = removeImpossibleSpeedSpikes(rawCoordinates, timeData);
    if (coordinates.length < 2) {
      throw new Error("This activity does not include enough usable route geometry.");
    }
    const geometry = {
      type: "LineString",
      coordinates
    };
    const startLocation = await reverseGeocodeStartLocation(coordinates[0]);
    let distanceMadeGood = null;
    if (pfpType === "Voyager") {
      const { data: calculatedDistanceMadeGood, error: distanceMadeGoodError } = await serviceClient.rpc("pfp_distance_made_good_km", {
        new_geometry_geojson: geometry,
        new_started_at: startedAt,
        new_source: "strava",
        new_source_activity_id: Number(activity.id),
        threshold_meters: 15,
        new_distance_meters: activity.distance
      });
      if (distanceMadeGoodError) {
        throw distanceMadeGoodError;
      }
      distanceMadeGood = cleanNumber(calculatedDistanceMadeGood);
    }
    const { data: importedActivity, error: upsertError } = await serviceClient.from("project_activities").upsert(
      {
        owner_user_id: user.id,
        source: "strava",
        source_activity_id: Number(activity.id),
        strava_type: "Activity",
        strava_url: `https://www.strava.com/activities/${activity.id}`,
        name: activity.name,
        sport_type: activity.sport_type ?? activity.type,
        started_at: startedAt,
        distance_meters: activity.distance,
        moving_time_seconds: activity.moving_time,
        elapsed_time_seconds: activity.elapsed_time,
        total_elevation_gain_meters: activity.total_elevation_gain,
        city: startLocation.city,
        state: startLocation.state,
        province: startLocation.province,
        country: startLocation.country,
        continent: startLocation.continent,
        corrected_distance: cleanNumber(Number(activity.distance) / 1e3),
        distance_made_good: distanceMadeGood,
        trail_name: cleanText2(metadata.trailName),
        pfp_type: pfpType,
        text_description: cleanText2(metadata.textDescription),
        geometry_geojson: geometry,
        geometry_simplified_low: {
          type: "LineString",
          coordinates: simplifyCoordinates(coordinates, geometryTolerances.low)
        },
        geometry_simplified_medium: {
          type: "LineString",
          coordinates: simplifyCoordinates(coordinates, geometryTolerances.medium)
        },
        geometry_simplified_high: {
          type: "LineString",
          coordinates: simplifyCoordinates(coordinates, geometryTolerances.high)
        },
        raw_activity: activity,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      },
      {
        onConflict: "source,source_activity_id"
      }
    ).select("id,name,pfp_type,distance_made_good").single();
    if (upsertError) {
      throw upsertError;
    }
    return Response.json({ activity: importedActivity }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500, headers }
    );
  }
});
