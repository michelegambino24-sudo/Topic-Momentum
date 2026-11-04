// ISO 3166-1 alpha-2 allowlist, including territories; not arbitrary two-letter strings.
export const COUNTRY_CODES = new Set("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "));
import "../site/places.js";
export const REGIONS = Object.fromEntries(Object.entries(globalThis.TMM_PLACES.regions).map(([id,place])=>[id,[...place.codes].sort()]));
const labels = { AE: "UAE", SA: "Saudi Arabia", QA: "Qatar", KW: "Kuwait", OM: "Oman", BH: "Bahrain", EG: "Egypt", JO: "Jordan", IR: "Iran", IQ: "Iraq", IL: "Israel", LB: "Lebanon", PS: "Palestine", SY: "Syria", TR: "Türkiye", YE: "Yemen" };
export function countryLabel(code) { return labels[code] || new Intl.DisplayNames(["en"], { type: "region" }).of(code); }
export function placeDetails(codes, presets, countryGroups = []) {
  const ordered = [...codes].sort();
  const region = Object.keys(REGIONS).find(id => JSON.stringify(REGIONS[id]) === JSON.stringify(ordered));
  if (region) return { label: globalThis.TMM_PLACES.regions[region].label, terms: presets[region]?[...presets[region].terms]:globalThis.TMM_PLACES.describe([region]).terms };
  return { label: ordered.map(countryLabel).join(", "), terms: [...new Set(ordered.flatMap(code => {
    const label = countryLabel(code);
    return countryGroups.find(item => item.label === label)?.terms || [label.toLowerCase()];
  }))] };
}
