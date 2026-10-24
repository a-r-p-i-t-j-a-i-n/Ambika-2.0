import React, {
  useState, useMemo, useRef, useCallback, lazy, Suspense,
} from 'react';
import {
  Box, Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText,
  Typography, IconButton, AppBar, Toolbar, useTheme, useMediaQuery,
  alpha, Avatar, Tooltip, Collapse,
} from '@mui/material';
import {
  Menu as MenuIcon, Mail, LayoutDashboard, ShoppingCart, Truck, FileText, Package,
  Users, UserCog, LogOut, CalendarPlus, CalendarDays, Radar, ChevronRight, ChevronLeft, ChevronDown, ShieldCheck,
  IndianRupee, Calculator, FileSignature, FilePen, ClipboardCheck, FolderOpen, BarChart3, Tag,
  Workflow, ListChecks, Gauge, SlidersHorizontal, ClipboardList, Trophy, PhoneCall, LayoutGrid,
  ReceiptText, FileSpreadsheet,
  Boxes, PackagePlus, PackageMinus, History, Layers, Recycle, PackageCheck, Factory,
  Cpu, HardHat, Disc3, ListOrdered,
} from 'lucide-react';
import { Badge } from '@mui/material';
import { useGetPendingRevisionsQuery } from '../store/api/pricingApi';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { logout } from '../store/slices/authSlice';
import { baseApi } from '../store/api/baseApi';
import { usePermissions } from '../hooks/usePermission';

import AmbikaLogo from '../assets/ambikalogo.jpeg';
import NotificationBell from '../features/notifications/NotificationBell';
import { isEmbedded } from '../utils/embed';

// Loaded the first time someone opens it, so it adds nothing to every page.
const StockCorrectionDrawer = lazy(() => import('../features/ims/StockCorrectionDrawer'));

const EXPANDED_WIDTH = 268;
const COLLAPSED_WIDTH = 76;

// Drill down to the first navigable leaf path of a (possibly nested) nav item —
// used by the collapsed rail, where nested dropdowns have no room to expand.
const firstLeafPath = (item) => (item.children ? firstLeafPath(item.children[0]) : item.path);

// ── Ambika 2.0 simplified sidebar ──────────────────────────────────────────
// The client wants a minimal nav: FMS (O2D / Purchase), Master, Employees.
// NOTHING was deleted — the complete 1.0 nav still lives in `navSectionsFull`
// below, and the permission-driven groups (Tasks, O2D FMS, Pricing, Admin) are
// gated behind this flag inside the `sections` memo. Flip to `true` to restore
// the entire old sidebar in one move.
const SHOW_FULL_NAV = false;

const navSectionsFull = [
  {
    title: 'Operations',
    items: [
      { text: 'Dashboard',         icon: <LayoutDashboard size={19} />, path: '/dashboard' },
      { text: 'Control Tower',     icon: <Radar size={19} />,           path: '/dispatch-control-tower' },
    ],
  },
  {
    title: '',
    items: [
      {
        text: 'O2D Pipeline',
        icon: <Workflow size={19} />,
        path: '/orders',
        children: [
          { text: 'Order Intake',      icon: <PhoneCall size={19} />,    path: '/order-intake' },
          { text: 'Sales Orders',      icon: <ShoppingCart size={19} />, path: '/orders' },
          { text: 'Dispatch Planning', icon: <CalendarPlus size={19} />, path: '/dispatch-planning' },
          { text: 'Dispatch Calendar', icon: <CalendarDays size={19} />, path: '/dispatch-planning/calendar' },
          { text: 'Plan vs Actual',    icon: <Radar size={19} />,        path: '/dispatch-planning/plan-vs-actual' },
          { text: 'Generate Dispatch Plan PDF', icon: <FileText size={19} />, path: '/dispatch-planning/generate-pdf' },
          { text: 'Email Dispatch Schedule', icon: <Mail size={19} />, path: '/o2d/dispatch-schedule-email' },
          { text: 'Actual Dispatch',   icon: <Truck size={19} />,        path: '/challans' },
          { text: 'Generate Challan PDF', icon: <FileText size={19} />,  path: '/challans/generate-pdf' },
          { text: 'Invoice & Eway Bill',  icon: <ReceiptText size={19} />, path: '/o2d/invoice-entry' },
          { text: 'Email Invoice & Eway', icon: <FileText size={19} />,    path: '/o2d/invoice-email' },
          { text: 'Track Delivery',       icon: <Truck size={19} />,       path: '/o2d/track-delivery' },
          { text: 'Payment Follow-up (2.10)',        icon: <IndianRupee size={19} />,     path: '/o2d/payments?part=followup', part: 'followup' },
          { text: 'Receive Payment & Tally (2.11)',  icon: <IndianRupee size={19} />,     path: '/o2d/payments?part=receipt',  part: 'receipt' },
          { text: 'Receive Transport Bill (2.12)',   icon: <FileSpreadsheet size={19} />, path: '/o2d/transport-bill?part=receive', part: 'receive' },
          { text: 'Transport Bill Payment Status (2.13)', icon: <FileSpreadsheet size={19} />, path: '/o2d/transport-bill?part=status', part: 'status' },
        ],
      },
      // Hidden until complete — restore to re-expose:
      // { text: 'Invoices & FMS', icon: <FileText size={19} />, path: '/invoices' },
    ],
  },
  {
    // Title-less section: the single "IMS" row is its own label. Click it to
    // reveal the inventory types; each type expands to its own screens
    // (a two-level dropdown: IMS → Consumables/RM/Finished Goods → navlinks).
    title: '',
    items: [
      {
        text: 'IMS',
        icon: <Boxes size={19} />,
        children: [
          {
            text: 'Consumables & Packaging',
            icon: <Package size={19} />,
            path: '/ims',
            children: [
              { text: 'Dashboard',             icon: <LayoutDashboard size={19} />, path: '/ims' },
              { text: 'Stock & Master Data',   icon: <Boxes size={19} />,           path: '/ims/stock' },
              { text: 'Stock In',              icon: <PackagePlus size={19} />,     path: '/ims/stock-in' },
              { text: 'Stock Out',             icon: <PackageMinus size={19} />,    path: '/ims/stock-out' },
              { text: 'Buying List',           icon: <ShoppingCart size={19} />,    path: '/ims/reorder' },
              { text: 'Movement History',      icon: <History size={19} />,         path: '/ims/movements' },
            ],
          },
          {
            text: 'Raw Material',
            icon: <Layers size={19} />,
            path: '/rm-ims',
            children: [
              { text: 'Dashboard',             icon: <LayoutDashboard size={19} />, path: '/rm-ims' },
              { text: 'Stock & Master Data',   icon: <Boxes size={19} />,           path: '/rm-ims/stock' },
              { text: 'Stock In',              icon: <PackagePlus size={19} />,     path: '/rm-ims/stock-in' },
              { text: 'Stock Out',             icon: <PackageMinus size={19} />,    path: '/rm-ims/stock-out' },
              { text: 'Cut Coils into Circles', icon: <Recycle size={19} />,        path: '/rm-ims/conversion' },
              { text: 'Buying List',           icon: <ShoppingCart size={19} />,    path: '/rm-ims/reorder' },
              { text: 'Movement History',      icon: <History size={19} />,         path: '/rm-ims/movements' },
            ],
          },
          {
            text: 'Finished Goods',
            icon: <PackageCheck size={19} />,
            path: '/fg-ims',
            children: [
              { text: 'Dashboard',             icon: <LayoutDashboard size={19} />, path: '/fg-ims' },
              { text: 'Stock & Master Data',   icon: <Boxes size={19} />,           path: '/fg-ims/stock' },
              { text: 'Production In (DPR)',   icon: <Factory size={19} />,         path: '/fg-ims/production-in' },
              { text: 'Dispatch Out',          icon: <Truck size={19} />,           path: '/fg-ims/dispatch-out' },
              { text: 'Production Plan',       icon: <ClipboardList size={19} />,   path: '/fg-ims/planning' },
              { text: 'Movement History',      icon: <History size={19} />,         path: '/fg-ims/movements' },
            ],
          },
          {
            text: 'Scrap',
            icon: <Recycle size={19} />,
            path: '/scrap-ims',
            children: [
              { text: 'Dashboard',             icon: <LayoutDashboard size={19} />, path: '/scrap-ims' },
              { text: 'Scrap Master Data',     icon: <Recycle size={19} />,         path: '/scrap-ims/records' },
              { text: 'Scrap Cut History',     icon: <ListOrdered size={19} />,     path: '/scrap-ims/history' },
              // Scrap grouped by the physical coil it came off — "how much
              // scrap came off THAT coil". The module's own strip lists it too,
              // but this sidebar is how people actually navigate, and a page
              // missing from here is a page nobody finds.
              { text: 'Scrap by Coil',         icon: <Disc3 size={19} />,           path: '/scrap-ims/by-coil' },
              { text: 'Scrap In',              icon: <PackagePlus size={19} />,     path: '/scrap-ims/scrap-in' },
              { text: 'Scrap Out',             icon: <PackageMinus size={19} />,    path: '/scrap-ims/scrap-out' },
              { text: 'Scrap Movement',        icon: <History size={19} />,         path: '/scrap-ims/movements' },
            ],
          },
          // Not a page: opens the Stock Correction drawer over whatever screen
          // is open — set any RM / Consumables / FG item to its physical count.
          { text: 'Stock Correction',      icon: <ClipboardCheck size={19} />,  action: 'stockCorrection' },
        ],
      },
    ],
  },
  /* ── PPC is hidden from the sidebar for the client (deploy). The routes still
     work; uncomment this section to re-expose it in the nav. ──
  {
    // Title-less section: the single "PPC" row is its own label. Production
    // Planning & Control — the shop-floor DPR entry, the OEE dashboards derived
    // from it, MIS scoring, and the routing/machine/die masters that feed them.
    title: '',
    items: [
      {
        text: 'PPC',
        icon: <Factory size={19} />,
        path: '/ppc/dpr/register',
        children: [
          { text: 'DPR Register',          icon: <ClipboardList size={19} />,      path: '/ppc/dpr/register' },
          { text: 'New DPR Entry',         icon: <FilePen size={19} />,            path: '/ppc/dpr/new' },
          { text: 'Machine Dashboard',     icon: <Gauge size={19} />,              path: '/ppc/dpr/machine' },
          { text: 'Production Dashboard',  icon: <BarChart3 size={19} />,          path: '/ppc/dpr/production' },
          { text: 'Operator Efficiency',   icon: <Users size={19} />,              path: '/ppc/dpr/operator' },
          { text: 'MIS Scoring',           icon: <Trophy size={19} />,             path: '/ppc/dpr/mis' },
          { text: 'Production Plan',       icon: <Package size={19} />,            path: '/ppc-planning' },
          { text: 'Masters',               icon: <SlidersHorizontal size={19} />,  path: '/ppc/dpr/masters' },
        ],
      },
    ],
  },
  */
  {
    // Title-less section: a single leaf row. All procurement screens now live
    // behind one unified workflow page with its own step navigation — see
    // PurchaseFmsHub — instead of a sidebar dropdown.
    title: '',
    items: [
      { text: 'Purchase FMS', icon: <ShoppingCart size={19} />, path: '/purchase-fms' },
    ],
  },
  {
    title: 'Master Data',
    items: [
      { text: 'SKU Master',        icon: <Package size={19} />,         path: '/skus' },
      { text: 'Parties',           icon: <Users size={19} />,           path: '/parties' },
    ],
  },
];

// ── Ambika 2.0 sidebar — the only three entries the client asked for ───────
// FMS expands to the two flows (O2D, Purchase); Master's contents are
// provisional (SKU + Parties) until the client confirms the final list.
const navSectionsSimple = [
  {
    title: '',
    items: [
      // Planning answers "what SHOULD we do", FMS "are we doing it", Master
      // "what do we do it with" — one question each, so nothing is ambiguous.
      // Download/Email are buttons on their own screens, never nav rows.
      {
        text: 'Planning',
        icon: <CalendarDays size={19} />,
        // Plan vs Actual is deliberately NOT here — the client does not want it
        // in the nav. Its route still works if opened directly.
        // Flat while each area has one screen; regroup under Dispatch/Production
        // sub-menus once either gains a second.
        children: [
          { text: 'Dispatch Calendar', icon: <Truck size={19} />,   path: '/dispatch-planning/calendar' },
          { text: 'Production Plan',   icon: <Factory size={19} />, path: '/production-planning' },
        ],
      },
      {
        text: 'FMS',
        icon: <Workflow size={19} />,
        children: [
          {
            text: 'O2D',
            icon: <Truck size={19} />,
            children: [
              { text: 'O2D FMS',         icon: <Workflow size={19} />, path: '/o2d-fms/steps' },
              { text: 'O2D Master Data', icon: <FileText size={19} />, path: '/o2d-fms/master-data' },
            ],
          },
          {
            text: 'Purchase',
            icon: <ShoppingCart size={19} />,
            children: [
              { text: 'Purchase FMS',   icon: <Workflow size={19} />, path: '/purchase-fms' },
              { text: 'Master Data',    icon: <FileText size={19} />, path: '/procurement/master-data' },
            ],
          },
          // Step-wise doers across FMS modules. `perm` hides the row from users
          // who cannot open it (the route is gated the same way).
          { text: 'My FMS Tasks',    icon: <ListChecks size={19} />,        path: '/fms/my-tasks' },
          { text: 'Doer Assignment', icon: <SlidersHorizontal size={19} />, path: '/fms/doer-assignment', perm: 'fms.manageDoers' },
        ],
      },
      {
        // Same two-level IMS tree as `navSectionsFull` (IMS -> inventory type
        // -> screens). The routes already existed; only the nav row was absent
        // from the simplified sidebar.
        text: 'IMS',
        icon: <Boxes size={19} />,
        children: [
          {
            text: 'Consumables & Packaging',
            icon: <Package size={19} />,
            path: '/ims',
            children: [
              { text: 'Dashboard',             icon: <LayoutDashboard size={19} />, path: '/ims' },
              { text: 'Stock & Master Data',   icon: <Boxes size={19} />,           path: '/ims/stock' },
              { text: 'Stock In',              icon: <PackagePlus size={19} />,     path: '/ims/stock-in' },
              { text: 'Stock Out',             icon: <PackageMinus size={19} />,    path: '/ims/stock-out' },
              { text: 'Buying List',           icon: <ShoppingCart size={19} />,    path: '/ims/reorder' },
              { text: 'Movement History',      icon: <History size={19} />,         path: '/ims/movements' },
            ],
          },
          {
            text: 'Raw Material',
            icon: <Layers size={19} />,
            path: '/rm-ims',
            children: [
              { text: 'Dashboard',             icon: <LayoutDashboard size={19} />, path: '/rm-ims' },
              { text: 'Stock & Master Data',   icon: <Boxes size={19} />,           path: '/rm-ims/stock' },
              { text: 'Stock In',              icon: <PackagePlus size={19} />,     path: '/rm-ims/stock-in' },
              { text: 'Stock Out',             icon: <PackageMinus size={19} />,    path: '/rm-ims/stock-out' },
              { text: 'Cut Coils into Circles', icon: <Recycle size={19} />,        path: '/rm-ims/conversion' },
              { text: 'Buying List',           icon: <ShoppingCart size={19} />,    path: '/rm-ims/reorder' },
              { text: 'Movement History',      icon: <History size={19} />,         path: '/rm-ims/movements' },
            ],
          },
          {
            text: 'Finished Goods',
            icon: <PackageCheck size={19} />,
            path: '/fg-ims',
            children: [
              { text: 'Dashboard',             icon: <LayoutDashboard size={19} />, path: '/fg-ims' },
              { text: 'Stock & Master Data',   icon: <Boxes size={19} />,           path: '/fg-ims/stock' },
              { text: 'Production In (DPR)',   icon: <Factory size={19} />,         path: '/fg-ims/production-in' },
              { text: 'Dispatch Out',          icon: <Truck size={19} />,           path: '/fg-ims/dispatch-out' },
              { text: 'Production Plan',       icon: <ClipboardList size={19} />,   path: '/fg-ims/planning' },
              { text: 'Movement History',      icon: <History size={19} />,         path: '/fg-ims/movements' },
            ],
          },
          {
            text: 'Scrap',
            icon: <Recycle size={19} />,
            path: '/scrap-ims',
            children: [
              { text: 'Dashboard',             icon: <LayoutDashboard size={19} />, path: '/scrap-ims' },
              { text: 'Scrap Master Data',     icon: <Recycle size={19} />,         path: '/scrap-ims/records' },
              { text: 'Scrap Cut History',     icon: <ListOrdered size={19} />,     path: '/scrap-ims/history' },
              // Scrap grouped by the physical coil it came off — "how much
              // scrap came off THAT coil". The module's own strip lists it too,
              // but this sidebar is how people actually navigate, and a page
              // missing from here is a page nobody finds.
              { text: 'Scrap by Coil',         icon: <Disc3 size={19} />,           path: '/scrap-ims/by-coil' },
              { text: 'Scrap In',              icon: <PackagePlus size={19} />,     path: '/scrap-ims/scrap-in' },
              { text: 'Scrap Out',             icon: <PackageMinus size={19} />,    path: '/scrap-ims/scrap-out' },
              { text: 'Scrap Movement',        icon: <History size={19} />,         path: '/scrap-ims/movements' },
            ],
          },
          // Not a page: opens the Stock Correction drawer over whatever screen
          // is open — set any RM / Consumables / FG item to its physical count.
          { text: 'Stock Correction',      icon: <ClipboardCheck size={19} />,  action: 'stockCorrection' },
        ],
      },
      {
        text: 'Master',
        icon: <FolderOpen size={19} />,
        children: [
          { text: 'SKU Master',         icon: <Package size={19} />, path: '/skus' },
          { text: 'Parties',            icon: <Users size={19} />,   path: '/parties' },
          { text: 'Machines',           icon: <Cpu size={19} />,     path: '/machines' },
          { text: 'Machine Operators',  icon: <HardHat size={19} />, path: '/machine-operators' },
          { text: 'Vendor Details',     icon: <UserCog size={19} />, path: '/procurement/vendors' },
          { text: 'Transporter Master', icon: <Truck size={19} />,   path: '/o2d-fms/transporters' },
        ],
      },
      { text: 'Employees', icon: <UserCog size={19} />, path: '/employees' },
    ],
  },
];

const navSections = SHOW_FULL_NAV ? navSectionsFull : navSectionsSimple;

const PAGE_TITLES = {
  '/dashboard':              'Dispatch Intelligence Hub',
  '/dispatch-control-tower': 'Control Tower',
  '/orders':                 'Sales Orders',
  '/dispatch-planning':      'Dispatch Planning',
  '/dispatch-planning/calendar': 'Dispatch Calendar',
  '/dispatch-planning/plan-vs-actual': 'Plan vs Actual',
  '/dispatch-planning/generate-pdf': 'Generate Dispatch Plan PDF',
  '/ppc-planning':           'PPC Planning',
  '/production-planning':    'Production Plan',
  '/challans':               'Actual Dispatch',
  '/challans/generate-pdf':  'Generate Challan PDF',
  '/o2d/invoice-entry':      'Create Invoice & Eway Bill',
  '/o2d/invoice-email':      'Email Invoice & Eway Bill',
  '/o2d/dispatch-schedule-email': 'Email Dispatch Schedule',
  '/o2d/track-delivery':     'Track Delivery',
  '/o2d/payments':           'Payment Follow-up & Receipt',
  '/o2d/payments?part=followup': 'Payment Follow-up (2.10)',
  '/o2d/payments?part=receipt':  'Receive Payment & Tally Entry (2.11)',
  '/o2d/transport-bill':     'Transport Bill',
  '/o2d/transport-bill?part=receive': 'Receive Transportation Bill (2.12)',
  '/o2d/transport-bill?part=status':  'Transport Bill Payment Status (2.13)',
  '/invoices':               'Invoices & FMS',
  '/skus':                   'SKU Master',
  '/parties':                'Party Master',
  '/machine-operators':      'Machine Operators',
  '/machines':               'Machines',
  '/procurement/indents':    'Purchase Indents',
  '/procurement/purchase-orders': 'Purchase Orders',
  '/procurement/follow-ups': 'Material Follow-ups',
  '/procurement/proforma-invoices': 'PI Forms',
  '/procurement/advance-payments': 'Advance Payments',

  '/procurement/grns': 'Goods Receipt Notes',
  '/procurement/service-completions': 'Service Completions',
  '/procurement/incoming-qc': 'Incoming QC',
  '/procurement/vendor-invoices': 'Vendor Invoices',
  '/procurement/vouchers':   'Payment Vouchers',
  '/procurement/tally-entries': 'Tally Entries',
  '/procurement/final-payments': 'Final Payments',
  '/procurement/master-data': 'Purchase Master Data',
  '/procurement/vendors': 'Master Vendor',

  // Purchase FMS — unified workflow page (step navigation lives inside it)
  '/purchase-fms/purchase-indents':    'Purchase FMS — Purchase Indents',
  '/purchase-fms/purchase-orders':     'Purchase FMS — Purchase Orders',
  '/purchase-fms/follow-ups':          'Purchase FMS — Follow-ups',
  // Old step slug — kept so a title still resolves for the instant before
  // PurchaseFmsHub's redirect to follow-ups takes effect.
  '/purchase-fms/material-follow-ups': 'Purchase FMS — Follow-ups',
  '/purchase-fms/pi-forms':            'Purchase FMS — PI Forms',
  '/purchase-fms/advance-payments':    'Purchase FMS — Advance Payments',
  '/purchase-fms/grn':                 'Purchase FMS — GRN & QC',
  '/purchase-fms/invoices-payments':   'Purchase FMS — Vendor Invoices & Payments',
  // Old step slugs — kept so a title still resolves for the instant before
  // PurchaseFmsHub's redirect to invoices-payments takes effect.
  '/purchase-fms/vendor-invoices':     'Purchase FMS — Vendor Invoices & Payments',
  '/purchase-fms/payment-vouchers':    'Purchase FMS — Vendor Invoices & Payments',
  '/purchase-fms/tally-entries':       'Purchase FMS — Tally Entries',
  '/purchase-fms/final-payments':      'Purchase FMS — Final Payments',
  '/purchase-fms':                     'Purchase FMS',
  '/fms/my-tasks':                     'FMS Tasks',
  '/fms/doer-assignment':              'FMS Doer Assignment',

  '/employees':              'Employees',
  '/access-control':         'Access Control',
  '/pricing':                'Pricing Hub',
  '/pricing/approvals':      'Approval Inbox',
  '/pricing/calculator':     'Turnover Calculator',
  '/pricing/documents':      'Pricing Documents',
  '/pricing/analytics':      'Pricing Analytics',
  '/quotes':                 'Quotes',
  // Listed before the bare '/o2d-fms' key — the title lookup is a first-match
  // startsWith scan, so the more specific path must come first.
  '/o2d-fms/steps':          'O2D — Step Board',
  '/o2d-fms':                'O2D FMS — My Tasks',
  '/o2d-fms/master':         'O2D FMS — Master View',
  '/o2d-fms/master-data':    'O2D Master Data',
  '/o2d-fms/transporters':   'Transporter Master',
  '/o2d-fms/processes':      'O2D FMS — Processes',
  '/o2d-fms/dashboard':      'O2D FMS — Management View',
  '/o2d-fms/scores':         'MIS Scoring',
  '/o2d-fms/config':         'O2D FMS — Step Catalog',
  '/profile':                'My Profile',

  // IMS families — deep paths listed before their base so startsWith resolves
  // to the most specific title first.
  '/ims/stock':              'Consumables & Packaging — Stock & Master',
  '/ims/item':               'Consumables & Packaging — Item',
  '/ims/stock-in':           'Consumables & Packaging — Stock In',
  '/ims/stock-out':          'Consumables & Packaging — Stock Out',
  '/ims/reorder':            'Consumables & Packaging — Buying List',
  '/ims/movements':          'Consumables & Packaging — Movements',
  '/ims':                    'Consumables & Packaging IMS',
  '/rm-ims/stock':           'Raw Material — Stock & Master',
  '/rm-ims/stock-in':        'Raw Material — Stock In',
  '/rm-ims/stock-out':       'Raw Material — Stock Out',
  '/rm-ims/conversion':      'Raw Material — Cut Coils into Circles',
  '/rm-ims/reorder':         'Raw Material — Buying List',
  '/rm-ims/movements':       'Raw Material — Movements',
  '/rm-ims':                 'Raw Material IMS',
  '/fg-ims/stock':           'Finished Goods — Stock & Master',
  '/fg-ims/item':            'Finished Goods — Item',
  '/scrap-ims/records':      'Scrap — Master Data',
  '/scrap-ims/history':      'Scrap — Cut History',
  '/scrap-ims/sku':          'Scrap — Coil SKU',
  '/scrap-ims/scrap-in':     'Scrap — Scrap In',
  '/scrap-ims/scrap-out':    'Scrap — Scrap Out',
  '/scrap-ims/movements':    'Scrap — Scrap Movement',
  '/scrap-ims/record':       'Scrap — Batch',
  '/scrap-ims':              'Scrap',
  '/fg-ims/production-in':   'Finished Goods — Production In (DPR)',
  '/fg-ims/dispatch-out':    'Finished Goods — Dispatch Out',
  '/fg-ims/planning':        'Finished Goods — Production Plan',
  '/fg-ims/movements':       'Finished Goods — Movements',
  '/fg-ims':                 'Finished Goods IMS',
};

const MainLayout = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  // IMS → Stock Correction opens a drawer, not a page.
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Tracks which expandable nav groups (e.g. Pricing Hub) the user has
  // toggled. `undefined` for a group falls back to auto-open when the active
  // route lives inside it.
  const [openMenus, setOpenMenus] = useState({});
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { user, isAuthenticated } = useSelector((state) => state.auth);
  const { can, canAny, isRoot } = usePermissions();

  const drawerWidth = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  // Live badge for the Approval Inbox sidebar entry.
  const { data: pendingRes } = useGetPendingRevisionsQuery(undefined, {
    skip: !isAuthenticated || (!can('pricing.approve') && !isRoot),
    pollingInterval: 60_000,
  });
  const pendingCount = pendingRes?.data?.length || 0;

  const sections = useMemo(() => {
    // Clone sections (and their item arrays) so we can splice without mutating
    // the static navSections definition.
    // Items may carry `perm` — drop them (at any depth) for users without it.
    const allowed = (it) => !it.perm || isRoot || can(it.perm);
    const prune = (items) => items.filter(allowed).map((it) => (it.children ? { ...it, children: prune(it.children) } : it));
    const out = navSections.map((s) => ({ ...s, items: prune(s.items) }));

    // Ambika 2.0: the permission-driven groups below (Tasks, O2D FMS, Pricing
    // & Revenue, Access Control / Employees) are part of the FULL 1.0 nav and
    // stay hidden until SHOW_FULL_NAV is flipped back on.
    if (!SHOW_FULL_NAV) return out;

    // ── Tasks + O2D FMS — two sibling collapsible groups under "O2D Pipeline" ──
    // Tasks = the doer/oversight task lists; O2D FMS = the flow itself + config.
    const taskChildren = [];
    if (can('o2dfms.view') || isRoot) {
      taskChildren.push({ text: 'My Tasks',  icon: <ListChecks size={19} />, path: '/o2d-fms' });
    }
    if (can('o2dfms.manage') || isRoot) {
      taskChildren.push({ text: 'All Tasks', icon: <ClipboardList size={19} />, path: '/o2d-fms/all-tasks' });
    }

    const fmsChildren = [];
    if (can('o2dfms.view') || isRoot) {
      fmsChildren.push({ text: 'Master FMS',   icon: <LayoutGrid size={19} />,        path: '/o2d-fms/master' });
      fmsChildren.push({ text: 'Master Data',  icon: <FileSpreadsheet size={19} />,   path: '/o2d-fms/master-data' });
      fmsChildren.push({ text: 'Transporter Master', icon: <Truck size={19} />,        path: '/o2d-fms/transporters' });
      fmsChildren.push({ text: 'FMS Tracker',  icon: <Workflow size={19} />,          path: '/o2d-fms/processes' });
      fmsChildren.push({ text: 'Dashboard',    icon: <Gauge size={19} />,             path: '/o2d-fms/dashboard' });
      fmsChildren.push({ text: 'MIS Scoring',  icon: <Gauge size={19} />,             path: '/o2d-fms/scores' });
    }
    if (can('o2dfms.config') || isRoot) {
      fmsChildren.push({ text: 'Step Builder',   icon: <SlidersHorizontal size={19} />, path: '/o2d-fms/config' });
      fmsChildren.push({ text: 'Task Templates', icon: <ClipboardList size={19} />,     path: '/o2d-fms/templates' });
    }

    // Find the O2D section by its content (the "O2D Pipeline" row), not its title
    // — the title is intentionally blank, so a string match would silently fail
    // and dump Tasks / O2D FMS into a stray section.
    const o2dSection = out.find((s) => s.items.some((it) => it.text === 'O2D Pipeline'));
    // Insert directly under "O2D Pipeline", Tasks first then O2D FMS.
    const groupsToAdd = [];
    if (taskChildren.length > 0) {
      groupsToAdd.push({ text: 'Tasks', icon: <ListChecks size={19} />, path: '/o2d-fms', children: taskChildren });
    }
    if (fmsChildren.length > 0) {
      groupsToAdd.push({ text: 'O2D FMS', icon: <Gauge size={19} />, path: '/o2d-fms/processes', children: fmsChildren });
    }
    if (groupsToAdd.length > 0) {
      if (o2dSection) {
        const idx = o2dSection.items.findIndex((it) => it.text === 'O2D Pipeline');
        o2dSection.items.splice(idx >= 0 ? idx + 1 : o2dSection.items.length, 0, ...groupsToAdd);
      } else {
        out.push({ title: 'O2D FMS', items: groupsToAdd });
      }
    }

    // ── Pricing & Revenue — everything collapsed under ONE dropdown ──
    const pricingChildren = [];
    if (can('pricing.view') || isRoot) {
      pricingChildren.push({ text: 'Selling Price', icon: <Tag size={17} />,          path: '/pricing',                stream: 'SELLING' });
      pricingChildren.push({ text: 'RM Cost',       icon: <ShoppingCart size={17} />, path: '/pricing?stream=RM_COST', stream: 'RM_COST' });
    }
    if (can('pricing.approve') || isRoot) {
      pricingChildren.push({
        text: 'Approval Inbox',
        icon: (
          <Badge color="warning" variant={pendingCount > 0 ? 'standard' : 'dot'} badgeContent={pendingCount} invisible={pendingCount === 0} overlap="circular">
            <ClipboardCheck size={17} />
          </Badge>
        ),
        path: '/pricing/approvals',
      });
    }
    if (can('pricing.view') || isRoot) pricingChildren.push({ text: 'Turnover Calculator', icon: <Calculator size={17} />, path: '/pricing/calculator' });
    if (can('pricing.view') || isRoot) pricingChildren.push({ text: 'Documents',           icon: <FolderOpen size={17} />, path: '/pricing/documents' });
    if (can('pricing.view') || isRoot) pricingChildren.push({ text: 'Analytics',           icon: <BarChart3 size={17} />,  path: '/pricing/analytics' });
    if (can('quotes.view')  || isRoot) pricingChildren.push({ text: 'Quotes',              icon: <FileSignature size={17} />, path: '/quotes' });
    if (can('quotes.view')  || isRoot) pricingChildren.push({ text: 'Saved Drafts',        icon: <FilePen size={17} />,       path: '/quotes/drafts' });
    if (pricingChildren.length > 0) {
      // Title-less section: the single expandable row IS the label, keeping it clean.
      out.push({ title: '', items: [
        { text: 'Pricing & Revenue', icon: <IndianRupee size={19} />, path: '/pricing', children: pricingChildren },
      ]});
    }

    // Administration
    const adminItems = [];
    if (canAny('accessControl.manageUsers', 'accessControl.manageRoles', 'accessControl.viewAuditLog') || isRoot) {
      adminItems.push({ text: 'Access Control', icon: <ShieldCheck size={19} />, path: '/access-control' });
    }
    if (user?.role === 'MD' || isRoot) {
      adminItems.push({ text: 'Employees', icon: <UserCog size={19} />, path: '/employees' });
    }
    if (adminItems.length > 0) {
      out.push({ title: 'Administration', items: adminItems });
    }

    return out;
  }, [user, can, canAny, isRoot, pendingCount]);

  // `useNavigate()` hands back a NEW function identity on every render of this
  // subtree. Calling it directly from the sidebar would make every nav row's
  // onClick unstable, which in turn makes the memoised drawer below rebuild on
  // every render. Route through a ref so `go` is stable for the component's
  // whole life while still calling the current navigate.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const go = useCallback((to) => navigateRef.current(to), []);

  const handleDrawerToggle = useCallback(() => setMobileOpen((v) => !v), []);
  const handleLogout = useCallback(() => {
    dispatch(logout());
    // Wipe all cached API data so the next user never sees the previous user's data.
    dispatch(baseApi.util.resetApiState());
    navigateRef.current('/login');
  }, [dispatch]);

  const initials = (user?.name || user?.email || 'U')
    .split(' ')
    .filter(Boolean)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const pageTitle = useMemo(() => {
    // Step screens that share a pathname carry a ?part — title them per step.
    const part = new URLSearchParams(location.search).get('part');
    const byPart = PAGE_TITLES[`${location.pathname}?part=${part}`];
    if (part && byPart) return byPart;
    const key = Object.keys(PAGE_TITLES).find((p) => location.pathname.startsWith(p));
    return key ? PAGE_TITLES[key] : 'AGL ERP';
  }, [location.pathname, location.search]);

  // Does the active route live anywhere inside this item's subtree? Recursive,
  // so a parent like "IMS" opens when any nested screen under it is active.
  const treeHasActive = (item) => {
    if (item.children) return item.children.some(treeHasActive);
    if (!item.path) return false;
    const p = item.path.split('?')[0];
    return location.pathname === p || (p !== '/' && location.pathname.startsWith(`${p}/`));
  };
  // A group is open if the user toggled it; otherwise it auto-opens whenever the
  // active route lives under one of its (possibly nested) descendants.
  const isMenuOpen = (item) => openMenus[item.text] ?? treeHasActive(item);

  // `mini` collapses the sidebar to icons only. The temporary (mobile)
  // drawer always renders the full version, so it is passed mini=false.
  const renderDrawerContent = (mini) => {
    // Renders a single navigable row. `indent` is used for sub-items inside
    // an expandable group so they sit visually under their parent.
    const leafButton = (item, isSelected, { indent = false, onClick } = {}) => (
      <ListItemButton
        onClick={onClick || (() => { go(item.path); if (isMobile) setMobileOpen(false); })}
        selected={isSelected}
        sx={{
          position: 'relative',
          borderRadius: 2,
          px: mini ? 0 : 1.25,
          pl: !mini && indent ? 3.5 : (mini ? 0 : 1.25),
          py: indent ? 0.7 : 0.9,
          justifyContent: mini ? 'center' : 'flex-start',
          color: 'text.primary',
          '&.Mui-selected': {
            background: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.10)} 0%, ${alpha(theme.palette.primary.main, 0.04)} 100%)`,
            color: 'primary.dark',
            '& .MuiListItemIcon-root': { color: 'primary.main' },
            '& .MuiListItemText-primary': { color: 'primary.dark', fontWeight: 700 },
            '&:hover': {
              background: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.14)} 0%, ${alpha(theme.palette.primary.main, 0.06)} 100%)`,
            },
            '&::before': {
              content: '""',
              position: 'absolute',
              left: mini ? 0 : -6,
              top: '20%',
              bottom: '20%',
              width: 3,
              borderRadius: 4,
              background: 'linear-gradient(180deg, #3b82f6 0%, #1e3a8a 100%)',
            },
          },
        }}
      >
        <ListItemIcon
          sx={{
            minWidth: mini ? 0 : (indent ? 30 : 34),
            justifyContent: 'center',
            color: isSelected ? 'primary.main' : 'text.secondary',
          }}
        >
          {item.icon}
        </ListItemIcon>
        {!mini && (
          <ListItemText
            primary={item.text}
            primaryTypographyProps={{
              fontSize: indent ? '0.83rem' : '0.875rem',
              fontWeight: isSelected ? 700 : 500,
              color: isSelected ? 'primary.dark' : 'text.primary',
            }}
          />
        )}
        {!mini && isSelected && !indent && (
          <ChevronRight size={15} color={theme.palette.primary.main} style={{ opacity: 0.7 }} />
        )}
      </ListItemButton>
    );

    // Renders one nav entry — recursively, so a group can itself contain groups
    // (e.g. IMS → Consumables / RM / Finished Goods → each type's screens).
    const renderNavItem = (item, depth = 0) => {
      const indent = depth > 0;

      // ── Expandable group (may itself contain nested groups) ──
      if (item.children) {
        const groupActive = !!item.path && location.pathname === item.path;
        const active = groupActive || treeHasActive(item);

        // Collapsed rail: no room to expand — jump straight to the first leaf.
        if (mini) {
          return (
            <ListItem key={item.text} disablePadding sx={{ mb: 0.25 }}>
              <Tooltip title={item.text} placement="right" arrow>
                <Box sx={{ width: '100%' }}>
                  {leafButton(item, active, {
                    onClick: () => { go(firstLeafPath(item)); if (isMobile) setMobileOpen(false); },
                  })}
                </Box>
              </Tooltip>
            </ListItem>
          );
        }

        const open = isMenuOpen(item);
        return (
          <React.Fragment key={item.text}>
            <ListItem disablePadding sx={{ mb: 0.25 }}>
              <ListItemButton
                onClick={() => setOpenMenus((m) => ({ ...m, [item.text]: !open }))}
                sx={{
                  borderRadius: 2, px: 1.25, pl: indent ? 2.75 : 1.25, py: indent ? 0.7 : 0.9,
                  color: active ? 'primary.dark' : 'text.primary',
                }}
              >
                <ListItemIcon sx={{ minWidth: indent ? 30 : 34, justifyContent: 'center', color: active ? 'primary.main' : 'text.secondary' }}>
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.text}
                  primaryTypographyProps={{
                    fontSize: indent ? '0.83rem' : '0.875rem',
                    fontWeight: active ? 700 : 500,
                    color: active ? 'primary.dark' : 'text.primary',
                  }}
                />
                {open
                  ? <ChevronDown size={15} color={theme.palette.text.secondary} />
                  : <ChevronRight size={15} color={theme.palette.text.secondary} />}
              </ListItemButton>
            </ListItem>
            {/* NO `unmountOnExit` here — it crashed the whole app.
                react-transition-group's Transition runs this on every update:

                  else if (props.unmountOnExit && state.status === EXITED)
                    this.setState({ status: UNMOUNTED })

                i.e. a *collapsed* group schedules a state update from
                componentDidUpdate — during the layout phase. MainLayout
                re-renders several times per navigation (the router hands
                `useNavigate()` a new identity as the route settles, and the
                lazy chunk and its queries each commit separately), and with
                nine groups — three of them nested, so they remount into EXITED
                whenever their parent re-enters — those updates compound past
                React's 50-nested-update ceiling. React then aborts the render
                with "Maximum update depth exceeded", which the RouteErrorBoundary
                catches and turns into the full-screen "Something went wrong"
                page. It fired on ANY navigation between two different nav
                groups, which is why it looked random.

                Without it the collapsed children simply stay mounted at height
                0 — a few dozen cheap list rows, and the animation is unchanged. */}
            <Collapse in={open} timeout={220}>
              <List disablePadding>
                {item.children.map((child) => renderNavItem(child, depth + 1))}
              </List>
            </Collapse>
          </React.Fragment>
        );
      }

      // ── Plain leaf ──
      // Pricing children share /pricing and disambiguate via the `stream` query
      // param; payment/transport steps share a pathname and use `part`; all other
      // leaves match by path (top-level uses a prefix, nested uses exact).
      // ── An action, not a page (Stock Correction): opens its drawer in place. ──
      if (item.action) {
        const runAction = () => {
          if (item.action === 'stockCorrection') setCorrectionOpen(true);
          if (isMobile) setMobileOpen(false);
        };
        const button = leafButton(item, false, { indent, onClick: runAction });
        return (
          <ListItem key={item.text} disablePadding sx={{ mb: 0.25 }}>
            {mini ? <Tooltip title={item.text} placement="right" arrow><Box sx={{ width: '100%' }}>{button}</Box></Tooltip> : button}
          </ListItem>
        );
      }
      const childPath = item.path.split('?')[0];
      const stream = new URLSearchParams(location.search).get('stream');
      const childPart = new URLSearchParams(location.search).get('part');
      const isSelected = item.stream
        ? (location.pathname === childPath && (item.stream === 'RM_COST' ? stream === 'RM_COST' : stream !== 'RM_COST'))
        : item.part
          ? (location.pathname === childPath && childPart === item.part)
          : depth === 0
            ? location.pathname.startsWith(item.path)
            : location.pathname === childPath;

      if (mini) {
        return (
          <ListItem key={item.text} disablePadding sx={{ mb: 0.25 }}>
            <Tooltip title={item.text} placement="right" arrow>
              <Box sx={{ width: '100%' }}>{leafButton(item, isSelected)}</Box>
            </Tooltip>
          </ListItem>
        );
      }
      return (
        <ListItem key={item.text} disablePadding sx={{ mb: 0.25 }}>
          {leafButton(item, isSelected, { indent })}
        </ListItem>
      );
    };

    return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(180deg, #ffffff 0%, #f5f8ff 100%)',
      }}
    >
      {/* Brand header */}
      <Box
        sx={{
          px: mini ? 1 : 2.5,
          py: 2.25,
          display: 'flex',
          alignItems: 'center',
          justifyContent: mini ? 'center' : 'flex-start',
          gap: 1.5,
          background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)',
          color: '#ffffff',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 2,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.14)',
            border: '1px solid rgba(255,255,255,0.22)',
            flexShrink: 0,
          }}
        >
          <img src={AmbikaLogo} alt="Ambika" style={{ width: 36, height: 36, objectFit: 'contain' }} />
        </Box>
        {!mini && (
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.01em', lineHeight: 1.1, color: '#ffffff' }}>
              AGL ERP
            </Typography>
            <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.78)' }}>
              Planning &middot; Execution
            </Typography>
          </Box>
        )}
      </Box>

      {/* Sections */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden', py: 1.25 }}>
        {sections.map((section, si) => (
          <Box key={section.title || `sec-${si}`} sx={{ px: mini ? 1 : 1.75, mb: 1.5 }}>
            {mini ? (
              <Box sx={{ height: 1, bgcolor: 'divider', mx: 1, mb: 1, opacity: 0.7 }} />
            ) : section.title ? (
              <Typography
                sx={{
                  px: 1.25,
                  py: 0.75,
                  fontSize: '0.66rem',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'text.secondary',
                }}
              >
                {section.title}
              </Typography>
            ) : null}
            <List disablePadding>
              {section.items.map((item) => renderNavItem(item, 0))}
            </List>
          </Box>
        ))}
      </Box>

      {/* User card + logout */}
      <Box sx={{ p: mini ? 1 : 1.75, borderTop: '1px solid', borderColor: 'divider' }}>
        {mini ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <Tooltip title={`${user?.name || 'Profile'} — view profile`} placement="right" arrow>
              <Avatar
                onClick={() => { go('/profile'); if (isMobile) setMobileOpen(false); }}
                sx={{
                  width: 38, height: 38, cursor: 'pointer',
                  background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
                  color: '#ffffff', fontWeight: 700, fontSize: '0.85rem',
                }}
              >
                {initials}
              </Avatar>
            </Tooltip>
            <Tooltip title="Sign out" placement="right" arrow>
              <IconButton
                size="small"
                onClick={handleLogout}
                sx={{
                  color: 'error.main',
                  bgcolor: alpha(theme.palette.error.main, 0.08),
                  '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.16), color: 'error.dark' },
                }}
              >
                <LogOut size={16} />
              </IconButton>
            </Tooltip>
          </Box>
        ) : (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              p: 0.5,
              pl: 1.25,
              borderRadius: 2.5,
              background: 'linear-gradient(135deg, #f5f8ff 0%, #eaf0fb 100%)',
              border: '1px solid',
              borderColor: 'divider',
              transition: 'all 0.18s ease',
              '&:hover': {
                borderColor: alpha(theme.palette.primary.main, 0.4),
                boxShadow: `0 2px 8px ${alpha(theme.palette.primary.main, 0.12)}`,
              },
            }}
          >
            <Tooltip title="View my profile" arrow placement="top">
              <Box
                role="button"
                tabIndex={0}
                onClick={() => { go('/profile'); if (isMobile) setMobileOpen(false); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    go('/profile');
                    if (isMobile) setMobileOpen(false);
                  }
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  py: 0.75,
                  flexGrow: 1,
                  minWidth: 0,
                  cursor: 'pointer',
                  borderRadius: 2,
                  outline: 'none',
                  '&:focus-visible': {
                    boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.35)}`,
                  },
                  '&:hover .user-name': { color: 'primary.dark' },
                }}
              >
                <Avatar
                  sx={{
                    width: 38, height: 38,
                    background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
                    color: '#ffffff', fontWeight: 700, fontSize: '0.85rem',
                  }}
                >
                  {initials}
                </Avatar>
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography
                    className="user-name"
                    sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'text.primary', lineHeight: 1.2, transition: 'color 0.15s' }}
                    noWrap
                  >
                    {user?.name || 'Loading…'}
                  </Typography>
                  <Typography sx={{ fontSize: '0.7rem', fontWeight: 500, color: 'text.secondary' }} noWrap>
                    {user?.role || 'Member'}
                  </Typography>
                </Box>
              </Box>
            </Tooltip>

            <NotificationBell />

            <Tooltip title="Sign out" arrow>
              <IconButton
                size="small"
                onClick={handleLogout}
                sx={{
                  mr: 0.5,
                  color: 'error.main',
                  bgcolor: alpha(theme.palette.error.main, 0.08),
                  '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.16), color: 'error.dark' },
                }}
              >
                <LogOut size={16} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
    </Box>
    );
  };

  // Build the sidebar once per meaningful change, not once per render.
  //
  // MainLayout re-renders several times for a single navigation — the router
  // hands `useNavigate()` a fresh identity as the route settles, and the lazy
  // route chunk plus its queries each land in their own commit. That is
  // survivable on its own, but the sidebar holds nine animated <Collapse>
  // groups, and a Collapse whose props change schedules a state update from
  // componentDidUpdate. Rebuilding the whole tree on every one of those renders
  // multiplied a handful of renders into enough nested updates to blow past
  // React's ceiling, so ANY navigation between two different nav groups could
  // abort with "Maximum update depth exceeded" and drop the user on the error
  // screen. Memoising keeps the transitions still between real changes.
  const mini = isMobile ? false : collapsed;
  const drawerContent = useMemo(
    // renderDrawerContent closes over exactly the values listed below (`go` and
    // `handleLogout` are the stable wrappers created above), so re-invoking it
    // only when one of them changes is complete — nothing goes stale.
    () => renderDrawerContent(mini),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mini, isMobile, sections, location.pathname, location.search, openMenus, user, initials, go, handleLogout],
  );

  // Embedded in the Delegation Suite: the Suite's sidebar drives navigation,
  // owns sign-out and shows ERP notifications in its own bell, so render no
  // drawer, no app bar, no profile/logout and no bell — just the page itself at
  // full width, starting right under the Suite's navbar.
  if (isEmbedded) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <Box component="main" sx={{ width: '100%', minWidth: 0 }}>
          <Outlet />
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Mobile top bar */}
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
          display: { sm: 'none' },
          backgroundColor: 'background.paper',
          color: 'text.primary',
          backgroundImage: 'none',
          boxShadow: 'none',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Toolbar sx={{ minHeight: 56 }}>
          <IconButton edge="start" onClick={handleDrawerToggle} sx={{ mr: 1.5, color: 'primary.main' }}>
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap sx={{ fontWeight: 700, color: 'primary.dark', flexGrow: 1 }}>
            {pageTitle}
          </Typography>
          <NotificationBell />
        </Toolbar>
      </AppBar>

      {/* Sidebar — exactly ONE nav tree is mounted at a time.
          Previously both drawers rendered at every breakpoint, the off-breakpoint
          one merely hidden with `display: none` (and the mobile one held open by
          `keepMounted`). That doubled the nav — including its nine <Collapse>
          transitions — and the hidden copy can never measure a height, so its
          transitions never settle. Switching in JS keeps the work to one tree. */}
      <Box component="nav" sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}>
        {isMobile ? (
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={handleDrawerToggle}
            sx={{ '& .MuiDrawer-paper': { boxSizing: 'border-box', width: EXPANDED_WIDTH } }}
          >
            {drawerContent}
          </Drawer>
        ) : (
          <Drawer
            variant="permanent"
            open
            sx={{
              '& .MuiDrawer-paper': {
                boxSizing: 'border-box',
                width: drawerWidth,
                overflowX: 'hidden',
                transition: theme.transitions.create('width', {
                  easing: theme.transitions.easing.sharp,
                  duration: theme.transitions.duration.shorter,
                }),
              },
            }}
          >
            {drawerContent}
          </Drawer>
        )}

        {/* Collapse / expand toggle — sits on the sidebar's edge (desktop only) */}
        <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right" arrow>
          <IconButton
            onClick={() => setCollapsed((v) => !v)}
            size="small"
            sx={{
              display: { xs: 'none', sm: 'flex' },
              position: 'fixed',
              top: 70,
              left: drawerWidth - 13,
              zIndex: (t) => t.zIndex.drawer + 2,
              width: 26,
              height: 26,
              bgcolor: '#ffffff',
              color: 'primary.main',
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.18)',
              transition: theme.transitions.create('left', {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.shorter,
              }),
              '&:hover': { bgcolor: '#ffffff', color: 'primary.dark', borderColor: 'primary.main' },
            }}
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </IconButton>
        </Tooltip>
      </Box>

      {/* Main content area */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          mt: { xs: 7, sm: 0 },
          minWidth: 0,
        }}
      >
        <Outlet />
      </Box>

      {/* IMS → Stock Correction: a drawer over the current page. Mounted only
          while open, so each opening starts from a clean form. */}
      {correctionOpen && (
        <Suspense fallback={null}>
          <StockCorrectionDrawer open={correctionOpen} onClose={() => setCorrectionOpen(false)} />
        </Suspense>
      )}
    </Box>
  );
};

export default MainLayout;
