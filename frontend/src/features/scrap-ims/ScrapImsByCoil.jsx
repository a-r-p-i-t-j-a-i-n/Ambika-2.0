import React, { useState } from 'react';
import {
  Box, Stack, Typography, TextField, InputAdornment, MenuItem, Paper,
} from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { Disc3, Search, Info } from 'lucide-react';
// LOCATION_TOKENS, not a new filter list: the Scrap register already builds
// its location dropdown from exactly these, and a second definition is the one
// that would still say "JW001" the day the client renames a site.
import {
  ScrapShell, Panel, O2D, LOCATION_TOKENS,
} from './scrapImsMeta';
import ScrapByCoilPanel from './ScrapByCoilPanel';

/**
 * SCRAP BY PHYSICAL COIL — its own screen, and its own place in the menu.
 *
 * The panel itself also sits on the Scrap overview, which is where someone
 * scanning the dashboard meets it. This page exists because that was not
 * enough: "how much scrap came off THAT coil" is a question people arrive
 * with already formed, and a section buried three panels down a dashboard is
 * not somewhere you can be sent. It is now a menu item, a URL that can be
 * pasted into a message, and a page that can be filtered on its own.
 */
const ScrapImsByCoil = () => {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') || '');
  const location = params.get('location') || 'ALL';

  const setParam = (key, value) => {
    if (value === 'ALL' || !value) params.delete(key); else params.set(key, value);
    setParams(params, { replace: true });
  };

  const filters = {
    ...(location !== 'ALL' ? { location } : {}),
    ...(search ? { search } : {}),
  };

  return (
    <ScrapShell
      icon={Disc3}
      title="Scrap by physical coil"
      subtitle="Every coil actually received — how many times it was cut, how much scrap it left, and how much of it is still on the floor."
    >
      <Paper elevation={0} sx={{ borderRadius: '8px', px: 1.5, py: 1, border: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Box sx={{ color: O2D.brand, display: 'flex', pt: 0.15 }}><Info size={15} /></Box>
          <Typography sx={{ fontSize: '0.73rem', color: O2D.body }}>
            This is <b>one row per physical coil</b> — the 2,000 kg coil that arrived on a particular GRN with its own
            batch number. It is <b>not</b> the same as “Scrap by coil grade”, which adds up every cut of a material.
            Click a row to open that coil and see each cutting round in order.
          </Typography>
        </Stack>
      </Paper>

      <Panel dense sx={{ p: 0 }} bodySx={{ p: 1.25 }}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <TextField
            size="small" value={search} onChange={(e) => { setSearch(e.target.value); setParam('search', e.target.value); }}
            placeholder="Search a batch number, coil code or cut…"
            sx={{ flex: '1 1 280px' }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }}
          />
          <TextField
            select size="small" label="Where it was cut" value={location}
            onChange={(e) => setParam('location', e.target.value)}
            sx={{ minWidth: 190 }}
          >
            <MenuItem value="ALL">All locations</MenuItem>
            <MenuItem value="PLG01">{LOCATION_TOKENS.PLG01.label}</MenuItem>
            <MenuItem value="JW001">{LOCATION_TOKENS.JW001.label}</MenuItem>
          </TextField>
        </Stack>
      </Panel>

      <ScrapByCoilPanel filters={filters} limit={50} />
    </ScrapShell>
  );
};

export default ScrapImsByCoil;
