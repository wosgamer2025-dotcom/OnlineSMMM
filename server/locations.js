import {
  getCities,
  getDistrictsAndNeighbourhoodsOfEachCity,
} from 'turkey-neighbourhoods';

// Turkey Provinces, Districts and Neighborhoods Database
const provincesList = [
  { id: '1', name: 'Adana' },
  { id: '2', name: 'Adıyaman' },
  { id: '3', name: 'Afyonkarahisar' },
  { id: '4', name: 'Ağrı' },
  { id: '5', name: 'Amasya' },
  { id: '6', name: 'Ankara' },
  { id: '7', name: 'Antalya' },
  { id: '8', name: 'Artvin' },
  { id: '9', name: 'Aydın' },
  { id: '10', name: 'Balıkesir' },
  { id: '11', name: 'Bilecik' },
  { id: '12', name: 'Bingöl' },
  { id: '13', name: 'Bitlis' },
  { id: '14', name: 'Bolu' },
  { id: '15', name: 'Burdur' },
  { id: '16', name: 'Bursa' },
  { id: '17', name: 'Çanakkale' },
  { id: '18', name: 'Çankırı' },
  { id: '19', name: 'Çorum' },
  { id: '20', name: 'Denizli' },
  { id: '21', name: 'Diyarbakır' },
  { id: '22', name: 'Edirne' },
  { id: '23', name: 'Elazığ' },
  { id: '24', name: 'Erzincan' },
  { id: '25', name: 'Erzurum' },
  { id: '26', name: 'Eskişehir' },
  { id: '27', name: 'Gaziantep' },
  { id: '28', name: 'Giresun' },
  { id: '29', name: 'Gümüşhane' },
  { id: '30', name: 'Hakkari' },
  { id: '31', name: 'Hatay' },
  { id: '32', name: 'Isparta' },
  { id: '33', name: 'Mersin' },
  { id: '34', name: 'İstanbul' },
  { id: '35', name: 'İzmir' },
  { id: '36', name: 'Kars' },
  { id: '37', name: 'Kastamonu' },
  { id: '38', name: 'Kayseri' },
  { id: '39', name: 'Kırklareli' },
  { id: '40', name: 'Kırşehir' },
  { id: '41', name: 'Kocaeli' },
  { id: '42', name: 'Konya' },
  { id: '43', name: 'Kütahya' },
  { id: '44', name: 'Malatya' },
  { id: '45', name: 'Manisa' },
  { id: '46', name: 'Kahramanmaraş' },
  { id: '47', name: 'Mardin' },
  { id: '48', name: 'Muğla' },
  { id: '49', name: 'Muş' },
  { id: '50', name: 'Nevşehir' },
  { id: '51', name: 'Niğde' },
  { id: '52', name: 'Ordu' },
  { id: '53', name: 'Rize' },
  { id: '54', name: 'Sakarya' },
  { id: '55', name: 'Samsun' },
  { id: '56', name: 'Siirt' },
  { id: '57', name: 'Sinop' },
  { id: '58', name: 'Sivas' },
  { id: '59', name: 'Tekirdağ' },
  { id: '60', name: 'Tokat' },
  { id: '61', name: 'Trabzon' },
  { id: '62', name: 'Tunceli' },
  { id: '63', name: 'Şanlıurfa' },
  { id: '64', name: 'Uşak' },
  { id: '65', name: 'Van' },
  { id: '66', name: 'Yozgat' },
  { id: '67', name: 'Zonguldak' },
  { id: '68', name: 'Aksaray' },
  { id: '69', name: 'Bayburt' },
  { id: '70', name: 'Karaman' },
  { id: '71', name: 'Kırıkkale' },
  { id: '72', name: 'Batman' },
  { id: '73', name: 'Şırnak' },
  { id: '74', name: 'Bartın' },
  { id: '75', name: 'Ardahan' },
  { id: '76', name: 'Iğdır' },
  { id: '77', name: 'Yalova' },
  { id: '78', name: 'Karabük' },
  { id: '79', name: 'Kilis' },
  { id: '80', name: 'Osmaniye' },
  { id: '81', name: 'Düzce' }
];

// Major districts for main provinces.
// If a province is not here, we dynamically fallback to default districts.
const customDistricts = {
  '34': [ // İstanbul
    { id: '34-1', name: 'Kadıköy' },
    { id: '34-2', name: 'Beşiktaş' },
    { id: '34-3', name: 'Şişli' },
    { id: '34-4', name: 'Fatih' },
    { id: '34-5', name: 'Üsküdar' },
    { id: '34-6', name: 'Maltepe' },
    { id: '34-7', name: 'Bakırköy' },
    { id: '34-8', name: 'Sarıyer' }
  ],
  '35': [ // İzmir
    { id: '35-1', name: 'Konak' },
    { id: '35-2', name: 'Bornova' },
    { id: '35-3', name: 'Karşıyaka' },
    { id: '35-4', name: 'Buca' },
    { id: '35-5', name: 'Bayraklı' },
    { id: '35-6', name: 'Çeşme' },
    { id: '35-7', name: 'Balçova' },
    { id: '35-8', name: 'Gaziemir' }
  ],
  '6': [ // Ankara
    { id: '6-1', name: 'Çankaya' },
    { id: '6-2', name: 'Keçiören' },
    { id: '6-3', name: 'Yenimahalle' },
    { id: '6-4', name: 'Mamak' },
    { id: '6-5', name: 'Etimesgut' },
    { id: '6-6', name: 'Gölbaşı' }
  ],
  '16': [ // Bursa
    { id: '16-1', name: 'Nilüfer' },
    { id: '16-2', name: 'Osmangazi' },
    { id: '16-3', name: 'Yıldırım' },
    { id: '16-4', name: 'Mudanya' }
  ]
};

// Neighborhoods for custom districts, fallback to generic ones.
const customNeighborhoods = {
  '34-1': [ // Kadıköy
    { id: '34-1-1', name: 'Caferağa Mah.' },
    { id: '34-1-2', name: 'Moda Mah.' },
    { id: '34-1-3', name: 'Göztepe Mah.' },
    { id: '34-1-4', name: 'Fenerbahçe Mah.' },
    { id: '34-1-5', name: 'Bostancı Mah.' }
  ],
  '34-2': [ // Beşiktaş
    { id: '34-2-1', name: 'Bebek Mah.' },
    { id: '34-2-2', name: 'Etiler Mah.' },
    { id: '34-2-3', name: 'Ortaköy Mah.' },
    { id: '34-2-4', name: 'Levazım Mah.' },
    { id: '34-2-5', name: 'Arnavutköy Mah.' }
  ],
  '35-1': [ // Konak
    { id: '35-1-1', name: 'Alsancak Mah.' },
    { id: '35-1-2', name: 'Kültür Mah.' },
    { id: '35-1-3', name: 'Göztepe Mah.' },
    { id: '35-1-4', name: 'Mithatpaşa Mah.' }
  ],
  '35-3': [ // Karşıyaka
    { id: '35-3-1', name: 'Mavişehir Mah.' },
    { id: '35-3-2', name: 'Bostanlı Mah.' },
    { id: '35-3-3', name: 'Bahçelievler Mah.' },
    { id: '35-3-4', name: 'Tuna Mah.' }
  ],
  '6-1': [ // Çankaya
    { id: '6-1-1', name: 'Kavaklıdere Mah.' },
    { id: '6-1-2', name: 'Bahçelievler Mah.' },
    { id: '6-1-3', name: 'Kızılay Mah.' },
    { id: '6-1-4', name: 'Yıldız Mah.' }
  ]
};

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/Ğ/g, 'g')
    .replace(/ş/g, 's')
    .replace(/Ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/Ç/g, 'c')
    .replace(/ö/g, 'o')
    .replace(/Ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/Ü/g, 'u')
    .toLowerCase();
}

function slugify(value, fallback = 'item') {
  const slug = normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function createGenericDistricts(provinceId, provinceName) {
  const prefix = provinceName || 'İl';
  return [
    { id: `${provinceId}-d1`, name: `${prefix} Merkez` },
    { id: `${provinceId}-d2`, name: 'Atatürk' },
    { id: `${provinceId}-d3`, name: 'Yeşilova' },
    { id: `${provinceId}-d4`, name: 'Ortaköy' },
  ];
}

function createGenericNeighborhoods(districtId) {
  return [
    { id: `${districtId}-n1`, name: 'Merkez Mah.' },
    { id: `${districtId}-n2`, name: 'Atatürk Mah.' },
    { id: `${districtId}-n3`, name: 'Cumhuriyet Mah.' },
    { id: `${districtId}-n4`, name: 'Yeni Mah.' },
    { id: `${districtId}-n5`, name: 'Hürriyet Mah.' },
  ];
}

function buildLegacyLocationCatalog() {
  return {
    source: {
      type: 'builtin',
      label: 'Eski yerleşik katalog',
      url: '',
      format: 'json',
      updatedAt: new Date().toISOString(),
    },
    provinces: provincesList.map((province) => {
      const districts = customDistricts[province.id] || createGenericDistricts(province.id, province.name);
      return {
        id: province.id,
        name: province.name,
        districts: districts.map((district) => ({
          id: district.id,
          name: district.name,
          neighborhoods: (customNeighborhoods[district.id] || createGenericNeighborhoods(district.id)).map((neighborhood) => ({
            id: neighborhood.id,
            name: neighborhood.name,
          })),
        })),
      };
    }),
  };
}

function buildDefaultLocationCatalog() {
  try {
    const districtsAndNeighborhoods = getDistrictsAndNeighbourhoodsOfEachCity();
    const provinces = getCities().map((city) => {
      const cityDistricts = districtsAndNeighborhoods[city.code] || {};
      return {
        id: city.code,
        name: city.name,
        districts: Object.entries(cityDistricts).map(([districtName, neighborhoods]) => {
          const districtId = `${city.code}-${slugify(districtName)}`;
          return {
            id: districtId,
            name: districtName,
            neighborhoods: [...new Set(neighborhoods || [])].map((neighborhoodName, neighborhoodIndex) => ({
              id: `${districtId}-${slugify(neighborhoodName, `n${neighborhoodIndex + 1}`)}`,
              name: neighborhoodName,
            })),
          };
        }),
      };
    });

    return {
      source: {
        type: 'builtin',
        label: 'turkey-neighbourhoods tam Türkiye adres kataloğu',
        url: 'npm:turkey-neighbourhoods@4.0.3',
        format: 'json',
        updatedAt: new Date().toISOString(),
      },
      provinces,
    };
  } catch {
    return buildLegacyLocationCatalog();
  }
}

export const defaultLocationCatalog = buildDefaultLocationCatalog();

function normalizeNeighborhood(neighborhood, districtId, index) {
  if (typeof neighborhood === 'string') {
    return {
      id: `${districtId || 'district'}-${slugify(neighborhood, `n${index + 1}`)}`,
      name: neighborhood.trim(),
    };
  }

  const name = String(neighborhood?.name || neighborhood?.mahalle || neighborhood?.neighborhood || '').trim();
  return {
    id: String(neighborhood?.id || `${districtId || 'district'}-${slugify(name, `n${index + 1}`)}`),
    name,
  };
}

function normalizeDistrict(district, provinceId, index) {
  if (typeof district === 'string') {
    const name = district.trim();
    return {
      id: `${provinceId || 'province'}-${slugify(name, `d${index + 1}`)}`,
      name,
      neighborhoods: [],
    };
  }

  const name = String(district?.name || district?.ilce || district?.district || '').trim();
  const districtId = String(district?.id || `${provinceId || 'province'}-${slugify(name, `d${index + 1}`)}`);
  const neighborhoods = Array.isArray(district?.neighborhoods)
    ? district.neighborhoods.map((item, neighborhoodIndex) => normalizeNeighborhood(item, districtId, neighborhoodIndex)).filter((item) => item.name)
    : [];
  return {
    id: districtId,
    name,
    neighborhoods,
  };
}

function normalizeProvince(province, index) {
  if (typeof province === 'string') {
    const name = province.trim();
    return {
      id: `${index + 1}`,
      name,
      districts: createGenericDistricts(String(index + 1), name).map((district) => ({
        ...district,
        neighborhoods: createGenericNeighborhoods(district.id),
      })),
    };
  }

  const name = String(province?.name || province?.il || province?.province || '').trim();
  const provinceId = String(province?.id || province?.code || `${index + 1}`);
  const districts = Array.isArray(province?.districts)
    ? province.districts.map((district, districtIndex) => normalizeDistrict(district, provinceId, districtIndex)).filter((item) => item.name)
    : [];

  return {
    id: provinceId,
    name,
    districts,
  };
}

function buildCatalogFromRows(rows) {
  const provinces = new Map();

  rows.forEach((row, index) => {
    const provinceName = String(row?.province || row?.il || row?.provinceName || row?.city || '').trim();
    const districtName = String(row?.district || row?.ilce || row?.districtName || '').trim();
    const neighborhoodName = String(row?.neighborhood || row?.mahalle || row?.neighborhoodName || '').trim();
    if (!provinceName || !districtName || !neighborhoodName) {
      return;
    }

    const provinceId = String(row?.provinceId || row?.ilKodu || row?.cityCode || slugify(provinceName, `p${index + 1}`));
    const districtId = String(row?.districtId || row?.ilceKodu || `${provinceId}-${slugify(districtName, `d${index + 1}`)}`);
    const neighborhoodId = String(row?.neighborhoodId || row?.mahalleKodu || `${districtId}-${slugify(neighborhoodName, `n${index + 1}`)}`);

    if (!provinces.has(provinceId)) {
      provinces.set(provinceId, {
        id: provinceId,
        name: provinceName,
        districts: new Map(),
      });
    }

    const province = provinces.get(provinceId);
    if (!province.districts.has(districtId)) {
      province.districts.set(districtId, {
        id: districtId,
        name: districtName,
        neighborhoods: new Map(),
      });
    }

    province.districts.get(districtId).neighborhoods.set(neighborhoodId, {
      id: neighborhoodId,
      name: neighborhoodName,
    });
  });

  return {
    source: {
      type: 'remote',
      label: 'Harici veri kaynağı',
      url: '',
      format: 'json',
      updatedAt: new Date().toISOString(),
    },
    provinces: Array.from(provinces.values()).map((province) => ({
      id: province.id,
      name: province.name,
      districts: Array.from(province.districts.values()).map((district) => ({
        id: district.id,
        name: district.name,
        neighborhoods: Array.from(district.neighborhoods.values()),
      })),
    })),
  };
}

function countCatalogItems(catalog) {
  const provinces = Array.isArray(catalog?.provinces) ? catalog.provinces : [];
  return {
    provinceCount: provinces.length,
    districtCount: provinces.reduce((count, province) => count + (Array.isArray(province.districts) ? province.districts.length : 0), 0),
    neighborhoodCount: provinces.reduce(
      (count, province) => count + (Array.isArray(province.districts)
        ? province.districts.reduce((districtCount, district) => districtCount + (Array.isArray(district.neighborhoods) ? district.neighborhoods.length : 0), 0)
        : 0),
      0,
    ),
  };
}

function shouldUpgradeLegacyBuiltinCatalog(input, normalized) {
  const sourceType = String(input?.source?.type || input?.sourceType || '').toLowerCase();
  const sourceLabel = String(input?.source?.label || input?.sourceLabel || '').toLowerCase();
  if (sourceType !== 'builtin') {
    return false;
  }
  const stats = countCatalogItems(normalized);
  return (
    stats.provinceCount < 81 ||
    stats.districtCount < 900 ||
    stats.neighborhoodCount < 70_000 ||
    sourceLabel.includes('eski') ||
    sourceLabel === 'yerleşik katalog'
  );
}

export function normalizeLocationCatalog(input) {
  if (!input) {
    return defaultLocationCatalog;
  }

  if (Array.isArray(input)) {
    return buildCatalogFromRows(input);
  }

  const provinces = Array.isArray(input.provinces)
    ? input.provinces.map((province, index) => normalizeProvince(province, index)).filter((item) => item.name)
    : null;

  if (provinces) {
    const normalizedCatalog = {
      source: {
        type: String(input.source?.type || input.sourceType || 'remote'),
        label: String(input.source?.label || input.sourceLabel || 'Harici veri kaynağı'),
        url: String(input.source?.url || input.sourceUrl || ''),
        format: String(input.source?.format || input.sourceFormat || 'json'),
        updatedAt: String(input.source?.updatedAt || input.updatedAt || new Date().toISOString()),
      },
      provinces: provinces.map((province) => ({
        ...province,
        districts: province.districts.length
          ? province.districts.map((district) => ({
              ...district,
              neighborhoods: district.neighborhoods.length ? district.neighborhoods : createGenericNeighborhoods(district.id),
            }))
          : createGenericDistricts(province.id, province.name).map((district) => ({
              ...district,
              neighborhoods: createGenericNeighborhoods(district.id),
        })),
      })),
    };
    return shouldUpgradeLegacyBuiltinCatalog(input, normalizedCatalog) ? defaultLocationCatalog : normalizedCatalog;
  }

  const rows = Array.isArray(input.rows) ? input.rows : Array.isArray(input.items) ? input.items : [];
  if (rows.length) {
    return buildCatalogFromRows(rows);
  }

  return defaultLocationCatalog;
}

function findProvince(catalog, provinceId) {
  const normalized = normalizeLocationCatalog(catalog);
  return normalized.provinces.find((province) => String(province.id) === String(provinceId));
}

function findDistrict(catalog, districtId) {
  const normalized = normalizeLocationCatalog(catalog);
  for (const province of normalized.provinces) {
    const district = province.districts.find((item) => String(item.id) === String(districtId));
    if (district) {
      return district;
    }
  }
  return null;
}

function listProvinces(catalog = defaultLocationCatalog) {
  return normalizeLocationCatalog(catalog).provinces.map((province) => ({ id: province.id, name: province.name }));
}

export function getProvinces(catalog = defaultLocationCatalog) {
  return listProvinces(catalog);
}

export function getDistricts(provinceId, catalog = defaultLocationCatalog) {
  const province = findProvince(catalog, provinceId);
  if (!province) {
    return [];
  }
  return province.districts.map((district) => ({ id: district.id, name: district.name }));
}

export function getNeighborhoods(districtId, catalog = defaultLocationCatalog) {
  const district = findDistrict(catalog, districtId);
  if (!district) {
    return [];
  }
  return district.neighborhoods.map((neighborhood) => ({ id: neighborhood.id, name: neighborhood.name }));
}

function parseDelimitedText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return [];
  }

  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if (!lines.length) {
    return [];
  }

  const sample = lines[0];
  const delimiter = sample.includes(';') && !sample.includes(',') ? ';' : sample.includes('\t') ? '\t' : ',';

  const parseLine = (line) => {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];
      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (!inQuotes && char === delimiter) {
        cells.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    cells.push(current.trim());
    return cells;
  };

  const headers = parseLine(lines[0]).map((header) => normalizeText(header));
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = cells[index] || '';
      return row;
    }, {});
  });
}

export async function syncLocationCatalogFromUrl(url) {
  const sourceUrl = String(url || '').trim();
  if (!sourceUrl) {
    throw new Error('Kaynak URL boş olamaz.');
  }

  const response = await fetch(sourceUrl, {
    headers: {
      Accept: 'application/json,text/csv,text/plain,*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`Kaynak indirilemedi (${response.status})`);
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const rawText = await response.text();
  const parsed = contentType.includes('json') || sourceUrl.endsWith('.json')
    ? JSON.parse(rawText)
    : parseDelimitedText(rawText);
  const catalog = normalizeLocationCatalog(parsed);
  return {
    catalog: {
      ...catalog,
      source: {
        ...catalog.source,
        type: 'remote',
        url: sourceUrl,
        updatedAt: new Date().toISOString(),
      },
    },
    format: contentType.includes('csv') || sourceUrl.endsWith('.csv') ? 'csv' : 'json',
  };
}
