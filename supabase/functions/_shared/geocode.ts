type Coordinate = [number, number] | [number, number, number];

type StartLocation = {
  city: string | null;
  state: string | null;
  province: string | null;
  country: string | null;
};

const countryNamesByCode: Record<string, string> = {
  CA: 'Canada',
  CAN: 'Canada',
  US: 'United States',
  USA: 'United States',
  NZ: 'New Zealand',
  NZL: 'New Zealand',
};

function cleanText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function countryNameFromCode(code: unknown) {
  const cleanCode = cleanText(code)?.toUpperCase();

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

export async function reverseGeocodeStartLocation(
  coordinate: Coordinate | undefined,
): Promise<StartLocation> {
  if (!coordinate) {
    return {
      city: null,
      state: null,
      province: null,
      country: null,
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
    };
  } catch (error) {
    console.error('Could not reverse geocode start location.', error);

    return {
      city: null,
      state: null,
      province: null,
      country: null,
    };
  }
}
