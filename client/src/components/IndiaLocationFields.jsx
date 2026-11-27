import { useEffect, useState } from 'react';

const LOCATION_API = 'https://india-lgd-index-api.vercel.app/v1';
const FIELD_CLASS = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-normal text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100';
let statesRequest;
const districtRequests = new Map();

async function loadList(url) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`Location list request failed (${response.status})`);
    const result = await response.json();
    if (!result.success || !Array.isArray(result.data)) throw new Error('Location list was unavailable');
    return result.data;
  } finally {
    window.clearTimeout(timeout);
  }
}

function getStates() {
  if (!statesRequest) {
    statesRequest = loadList(`${LOCATION_API}/states`).catch((error) => {
      statesRequest = null;
      throw error;
    });
  }
  return statesRequest;
}

function getDistricts(stateCode) {
  if (!districtRequests.has(stateCode)) {
    districtRequests.set(stateCode, loadList(`${LOCATION_API}/districts?state=${encodeURIComponent(stateCode)}`).catch((error) => {
      districtRequests.delete(stateCode);
      throw error;
    }));
  }
  return districtRequests.get(stateCode);
}

function samePlace(left, right) {
  return String(left || '').trim().toLocaleLowerCase('en') === String(right || '').trim().toLocaleLowerCase('en');
}

function displayPlace(name) {
  return String(name || '').toLocaleLowerCase('en').replace(/(^|[\s(-])\p{L}/gu, (letter) => letter.toLocaleUpperCase('en'));
}

export default function IndiaLocationFields({
  country = 'India', state = '', district = '', onChange,
  stateLabel = 'State / UT', districtLabel = 'District', disabled = false,
}) {
  const isIndia = samePlace(country, 'India');
  const [states, setStates] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [statesError, setStatesError] = useState('');
  const [districtsError, setDistrictsError] = useState('');
  const [statesLoading, setStatesLoading] = useState(false);
  const [districtsLoading, setDistrictsLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!isIndia) {
      setStates([]);
      setDistricts([]);
      setStatesError('');
      setDistrictsError('');
      return () => { active = false; };
    }
    setStatesLoading(true);
    getStates().then((rows) => {
      if (active) { setStates(rows); setStatesError(''); }
    }).catch(() => {
      if (active) setStatesError('Could not load the India location list. You can enter these manually.');
    }).finally(() => { if (active) setStatesLoading(false); });
    return () => { active = false; };
  }, [isIndia]);

  const selectedState = states.find((item) => samePlace(item.name, state));
  useEffect(() => {
    let active = true;
    setDistricts([]);
    setDistrictsError('');
    if (!isIndia || !selectedState?.code) {
      setDistrictsLoading(false);
      return () => { active = false; };
    }
    setDistrictsLoading(true);
    getDistricts(selectedState.code).then((rows) => {
      if (active) { setDistricts(rows); setDistrictsError(''); }
    }).catch(() => {
      if (active) setDistrictsError('Could not load districts. You can enter the district manually.');
    }).finally(() => { if (active) setDistrictsLoading(false); });
    return () => { active = false; };
  }, [isIndia, selectedState?.code]);

  if (!isIndia || statesError) {
    return <>
      <label className="block text-sm font-semibold text-slate-700">{stateLabel}
        <input maxLength={100} value={state} disabled={disabled} onChange={(event) => onChange({ state: event.target.value, district: '' })} className={FIELD_CLASS} />
      </label>
      <label className="block text-sm font-semibold text-slate-700">{districtLabel}
        <input maxLength={100} value={district} disabled={disabled} onChange={(event) => onChange({ district: event.target.value })} className={FIELD_CLASS} />
      </label>
      {statesError && <p className="text-xs font-normal text-amber-700 sm:col-span-2">{statesError}</p>}
    </>;
  }

  const savedStateMissing = state && !selectedState;
  const savedDistrictMissing = district && !districts.some((item) => samePlace(item.name, district));
  return <>
    <label className="block text-sm font-semibold text-slate-700">{stateLabel}
      <select value={state} disabled={disabled || statesLoading} onChange={(event) => onChange({ state: event.target.value, district: '' })} className={FIELD_CLASS}>
        <option value="">{statesLoading ? 'Loading states and UTs...' : 'Select a state or UT'}</option>
        {savedStateMissing && <option value={state}>{state} (saved location)</option>}
        {states.map((item) => <option key={item.code} value={item.name}>{displayPlace(item.name)}</option>)}
      </select>
    </label>
    <label className="block text-sm font-semibold text-slate-700">{districtLabel}
      {!selectedState || districtsError ? <input maxLength={100} value={district} disabled={disabled || (!selectedState && !state)} onChange={(event) => onChange({ district: event.target.value })} placeholder={selectedState ? 'Enter district' : 'Choose a state first'} className={FIELD_CLASS} /> : (
        <select value={district} disabled={disabled || districtsLoading} onChange={(event) => onChange({ district: event.target.value })} className={FIELD_CLASS}>
          <option value="">{districtsLoading ? 'Loading districts...' : 'Select a district'}</option>
          {savedDistrictMissing && <option value={district}>{district} (saved location)</option>}
          {districts.map((item) => <option key={item.code} value={item.name}>{displayPlace(item.name)}</option>)}
        </select>
      )}
      {districtsError && <span className="mt-1 block text-xs font-normal text-amber-700">{districtsError}</span>}
    </label>
    <p className="text-xs font-normal text-slate-400 sm:col-span-2">Location data: <a className="underline hover:text-emerald-700" href="https://india-lgd-index-api.vercel.app/docs" target="_blank" rel="noreferrer">LGD data API</a> · <a className="underline hover:text-emerald-700" href="https://lgdirectory.gov.in/" target="_blank" rel="noreferrer">Government of India directory</a>.</p>
  </>;
}
