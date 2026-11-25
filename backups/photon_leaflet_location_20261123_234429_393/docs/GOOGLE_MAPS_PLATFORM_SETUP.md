# Google Maps Platform setup for the class location picker

The College Admin class location picker uses the Maps JavaScript API and Places API (New). Configure this in the frontend environment; never put a key in application source code or commit it.

## Frontend environment

Set this variable in the local frontend environment and restart Vite:

```dotenv
VITE_GOOGLE_MAPS_API_KEY=
```

The key is delivered to a browser, so restrict it by allowed website referrers and by API. Do not reuse a server-side key. `VITE_GOOGLE_MAP_ID` is optional for the current demo map; set it to a Map ID created for your Google Cloud project when enabling production advanced markers.

## Google Cloud steps

1. Create or select a Google Cloud project.
2. Enable billing for that project.
3. Enable **Maps JavaScript API** and **Places API (New)**.
4. Create a browser API key.
5. Restrict the key to those APIs.
6. Add website/referrer restrictions for the local development origin(s), such as `http://localhost:5173/*` and `http://127.0.0.1:5173/*`, and the eventual AttendX domain.
7. Add the key to the local frontend environment, restart Vite, and verify the browser origin matches the referrer restriction.

If the key is missing or rejected, Google place search is unavailable and the page reports the setup problem. The College Admin can still set a location manually on the OpenStreetMap fallback. A selected Google place is only a provider-supplied point (often an entrance or campus location); the Admin must adjust and confirm the classroom pin. No classroom location is changed until the existing Save Class action succeeds.

The class picker stores only the existing class location name, latitude, longitude, and radius fields. It does not alter the radius policy or attendance data. Other AttendX maps continue using the existing Leaflet component.
