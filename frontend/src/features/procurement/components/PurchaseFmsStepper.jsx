import React from 'react';
import { Box } from '@mui/material';
import {
  ClipboardList, FileSearch, FileCheck2, ShoppingBag, PhoneCall, FileText, Wallet, PackageCheck,
  ReceiptText, FileSpreadsheet, Banknote, Workflow,
} from 'lucide-react';
import { StepCard, stepTone, STEP_RAIL_SX, useStepRail } from '../../o2d-fms/components/O2dStepCard';
import { pfmsCardCycleSx } from '../pfmsTheme';

// Each Purchase FMS step's own icon (by its hub slug).
const STEP_ICONS = {
  'purchase-indents': ClipboardList,
  'receive-quotes': FileSearch,
  'approved-quotations': FileCheck2,
  'purchase-orders': ShoppingBag,
  'follow-ups': PhoneCall,
  'pi-forms': FileText,
  'advance-payments': Wallet,
  grn: PackageCheck,
  'invoices-payments': ReceiptText,
  'tally-entries': FileSpreadsheet,
  'final-payments': Banknote,
};

// The Purchase FMS step rail = the O2D step cards (Step Board / Master Data):
// one 193 x 72 card per step — icon, its own pastel, the step's count as the
// figure, the step name beneath. Click (or Enter / Space) = the same step
// navigation as before. The strip scrolls sideways inside itself (never the
// page) and keeps the active step centred.
const PurchaseFmsStepper = ({ steps, activeIndex, onStepClick, counts, hints }) => {
  const { railRef } = useStepRail(activeIndex, steps.length);
  return (
    <Box ref={railRef} data-testid="pfms-step-rail" role="group" aria-label="Purchase FMS steps" sx={{ ...STEP_RAIL_SX, ...pfmsCardCycleSx }}>
      {steps.map((step, i) => {
        const active = i === activeIndex;
        const count = counts?.[step.slug];
        return (
          <StepCard
            key={step.slug}
            testId={`pfms-step-${step.slug}`} data-active={active ? 'true' : undefined}
            aria-current={active ? 'step' : undefined}
            title={hints?.[step.slug] ? `${step.label}: ${hints[step.slug]}` : undefined}
            code={step.code || String(i + 1)} name={step.label} unit="records"
            badge={count ?? '—'}
            tone={stepTone(i)} icon={STEP_ICONS[step.slug] || Workflow} active={active}
            onClick={() => onStepClick(step.slug)}
          />
        );
      })}
    </Box>
  );
};

export default PurchaseFmsStepper;
