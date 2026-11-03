import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  CircularProgress,
  Alert,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import {
  CheckCircle2,
  XCircle,
  X,
  Building2,
  ClipboardCheck,
  FileText,
  ExternalLink,
  Download,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { useSnackbar } from "notistack";
import {
  useApprovePurchaseOrderMutation,
  useGetPurchaseOrderQuery,
  usePreviewPurchaseOrderPdfMutation,
} from "../../../store/api/procurementApi";
import { fmtINR, fmtDate, poDisplayNumber } from "./poMeta";
import { effectivePoTerms, PO_FORMAT_LABEL } from "./poTerms";

/**
 * Review and approve / reject a draft Vendor PO (Step 1.4A).
 * Everything the approver needs on one screen: the PO's vendor, terms, items
 * and totals on the left, its PDF on the right, the decision at the bottom.
 * The PDF is rendered from the saved PO by the preview endpoint — nothing is
 * stored, so a look never changes the PO.
 */

const LINE = "#e2e8f0";
const INK = "#0f172a";
const SUB = "#64748b";
const BLUE = "#1d4ed8";

const idOf = (v) => (v && typeof v === "object" ? v._id : v) || undefined;
const qty = (n) =>
  Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });

// The saved PO in the preview endpoint's shape (only the fields it accepts).
const pdfBody = (po) => {
  const jsl = po.poFormatType === "JSL";
  const line = (it) => ({
    itemName: it.itemName || "",
    skuCode: it.skuCode || "",
    skuId: idOf(it.skuId),
    indentId: idOf(it.indentId),
    indentNumber: it.indentNumber || "",
    indentItemId: idOf(it.indentItemId),
    indentItemDisplayNumber: it.indentItemDisplayNumber || "",
    quantity: Number(it.quantity),
    ...(jsl
      ? {
          grade: it.grade || "",
          width: it.width || "",
          finish: it.finish || "",
          unit: it.unit || "Kgs",
          baseRate: Number(it.baseRate) || 0,
          upfrontDiscount: Number(it.upfrontDiscount) || 0,
          bonanzaDiscount: Number(it.bonanzaDiscount) || 0,
        }
      : {
          hsn: it.hsn || "",
          unit: it.unit || "Pcs",
          rate: Number(it.rate) || 0,
          gstRate: Number(it.gstRate) || 0,
        }),
  });
  return {
    vendorId: idOf(po.vendorId),
    poFormatType: jsl ? "JSL" : "OTHER",
    poNumber: poDisplayNumber(po),
    poDate: po.poDate,
    expectedDeliveryDate: po.expectedDeliveryDate || null,
    vendorName: po.vendorName || "",
    vendorGST: po.vendorGST || "",
    vendorPAN: po.vendorPAN || "",
    vendorAddress: po.vendorAddress || "",
    vendorEmail: po.vendorEmail || "",
    vendorPhone: po.vendorPhone || "",
    deliveryTerms: po.deliveryTerms || "",
    paymentTerms: po.paymentTerms || "",
    leadTimeDays: po.leadTimeDays ?? null,
    creditPeriod: Number(po.creditPeriod) || 0,
    remarks: po.remarks || "",
    termsAndConditions: effectivePoTerms(po, null),
    items: (po.items || []).filter((it) => Number(it.quantity) > 0).map(line),
  };
};

const Fact = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography
      sx={{
        fontSize: "0.68rem",
        fontWeight: 700,
        color: SUB,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
      }}
    >
      {label}
    </Typography>
    <Typography
      sx={{
        fontSize: "0.84rem",
        fontWeight: 700,
        color: INK,
        wordBreak: "break-word",
      }}
    >
      {value || "—"}
    </Typography>
  </Box>
);

const Section = ({ title, children, right }) => (
  <Box
    sx={{
      p: 1.75,
      borderRadius: 2,
      bgcolor: "#fff",
      border: `1px solid ${LINE}`,
    }}
  >
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      sx={{ mb: 1.25 }}
    >
      <Typography sx={{ fontSize: "0.8rem", fontWeight: 800, color: INK }}>
        {title}
      </Typography>
      {right}
    </Stack>
    {children}
  </Box>
);

const ItemRow = ({ it, jsl, first }) => {
  const name = jsl
    ? [it.grade, it.width && `${it.width} mm`, it.finish]
        .filter(Boolean)
        .join(" · ") || it.itemName
    : it.itemName;
  const amount = jsl ? it.value : it.totalAmount || it.taxableAmount;
  const rateChange = ["PENDING", "REJECTED"].includes(it.rateChangeStatus);
  return (
    <Box sx={{ py: 1.1, borderTop: first ? "none" : `1px solid ${LINE}` }}>
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: "0.84rem",
              fontWeight: 700,
              color: INK,
              lineHeight: 1.35,
            }}
          >
            {name || "—"}
          </Typography>
          <Typography sx={{ fontSize: "0.72rem", color: SUB }}>
            {[
              it.indentItemDisplayNumber,
              it.skuCode && `SKU ${it.skuCode}`,
              it.hsn && `HSN ${it.hsn}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Typography>
          <Typography sx={{ fontSize: "0.76rem", color: "#334155", mt: 0.25 }}>
            {qty(it.quantity)} {it.unit} ×{" "}
            {fmtINR(jsl ? it.finalPrice : it.rate)}
            {!jsl && ` · GST ${it.gstRate || 0}%`}
          </Typography>
        </Box>
        <Typography
          sx={{
            fontSize: "0.86rem",
            fontWeight: 800,
            color: INK,
            whiteSpace: "nowrap",
          }}
        >
          {fmtINR(amount)}
        </Typography>
      </Stack>
      {rateChange && (
        <Stack
          direction="row"
          spacing={0.75}
          alignItems="center"
          sx={{
            mt: 0.75,
            px: 1,
            py: 0.5,
            borderRadius: 1.5,
            bgcolor: "#fff7e6",
            color: "#b45309",
          }}
        >
          <AlertTriangle size={13} style={{ flexShrink: 0 }} />
          <Typography
            sx={{ fontSize: "0.72rem", fontWeight: 600, color: "inherit" }}
          >
            Rate changed from the Vendor Master
            {it.fetchedRate != null ? ` (${fmtINR(it.fetchedRate)})` : ""} —
            rate change
            {it.rateChangeRequestNumber
              ? ` ${it.rateChangeRequestNumber}`
              : ""}{" "}
            is {it.rateChangeStatus === "PENDING" ? "pending" : "rejected"}
          </Typography>
        </Stack>
      )}
    </Box>
  );
};

// The PO PDF, rendered from the saved PO (blob URL, released on close).
const usePoPdf = (po, ready) => {
  const [previewPdf] = usePreviewPurchaseOrderPdfMutation();
  const [state, setState] = useState({ url: "", error: "", loading: true });
  const [attempt, setAttempt] = useState(0);
  const key = ready ? `${po?._id}:${po?.updatedAt || ""}:${attempt}` : "";
  useEffect(() => {
    if (!key) return undefined;
    let url = "";
    let live = true;
    previewPdf(pdfBody(po))
      .unwrap()
      .then((blob) => {
        if (!(blob instanceof Blob) || blob.type === "application/json")
          throw new Error("The preview did not return a PDF");
        url = URL.createObjectURL(blob);
        if (live) setState({ url, error: "", loading: false });
        else URL.revokeObjectURL(url);
      })
      .catch((err) => {
        if (live)
          setState({
            url: "",
            error:
              err?.data?.message || err?.message || "Could not make the PDF",
            loading: false,
          });
      });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
    // `key` stands for the PO version being shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const retry = () => {
    setState({ url: "", error: "", loading: true });
    setAttempt((n) => n + 1);
  };
  return { ...state, retry };
};

const ApprovalForm = ({ po: given, approvePo, deciding, onClose }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [remarks, setRemarks] = useState("");
  // The full PO (a list row may carry less).
  const { data, isLoading } = useGetPurchaseOrderQuery(given._id);
  const po = data?.data || given;
  const pdf = usePoPdf(po, !isLoading);
  const jsl = po.poFormatType === "JSL";
  const items = po.items || [];
  const indents = (
    po.indentNumbers?.length ? po.indentNumbers : [po.indentNumber]
  )
    .filter(Boolean)
    .join(", ");
  const pdfName = `${String(poDisplayNumber(po)).replace(/[^\w.-]/g, "_")}.pdf`;

  // Rate changes still waiting in Purchase Approval hold the PO (the server refuses
  // the approval as well — this just says so before the click).
  const pendingRates = items.filter((it) => it.rateChangeStatus === "PENDING");

  const decide = async (decision) => {
    try {
      const res = await approvePo({
        id: po._id,
        decision,
        remarks: remarks.trim(),
      }).unwrap();
      const msg =
        decision === "REJECTED"
          ? "PO rejected"
          : `PO approved — ${poDisplayNumber(res?.data)}`;
      enqueueSnackbar(msg, {
        variant: decision === "REJECTED" ? "info" : "success",
      });
      onClose(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || "Failed to save decision", {
        variant: "error",
      });
    }
  };

  return (
    <>
      <DialogTitle
        component="div"
        sx={{
          px: 2.5,
          py: 1.5,
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          borderBottom: `1px solid ${LINE}`,
        }}
      >
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            bgcolor: alpha(BLUE, 0.1),
            color: BLUE,
            flexShrink: 0,
          }}
        >
          <ClipboardCheck size={18} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            flexWrap="wrap"
            useFlexGap
          >
            <Typography sx={{ fontWeight: 800, fontSize: "1rem", color: INK }}>
              Review &amp; Approve Purchase Order
            </Typography>
            <Chip
              size="small"
              label={poDisplayNumber(po)}
              sx={{
                height: 22,
                fontWeight: 700,
                bgcolor: alpha(BLUE, 0.08),
                color: BLUE,
              }}
            />
          </Stack>
          <Typography sx={{ fontSize: "0.74rem", color: SUB }}>
            Step 1.4A · Check the details and the PDF, then approve or reject
          </Typography>
        </Box>
        <IconButton
          size="small"
          onClick={() => onClose(false)}
          disabled={deciding}
        >
          <X size={18} />
        </IconButton>
      </DialogTitle>

      <DialogContent
        sx={{
          p: 0,
          display: "grid",
          overflow: { xs: "auto", md: "hidden" },
          gridTemplateColumns: {
            xs: "1fr",
            md: "400px minmax(0, 1fr)",
            lg: "440px minmax(0, 1fr)",
          },
          gridTemplateRows: { md: "minmax(0, 1fr)" },
        }}
      >
        {/* Details */}
        <Stack
          spacing={1.5}
          sx={{
            p: 2,
            bgcolor: "#f8fafc",
            overflowY: { md: "auto" },
            borderRight: { md: `1px solid ${LINE}` },
          }}
        >
          <Section title="Vendor">
            <Stack direction="row" spacing={1.25} alignItems="flex-start">
              <Building2
                size={18}
                color={BLUE}
                style={{ flexShrink: 0, marginTop: 2 }}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{ fontWeight: 800, fontSize: "0.92rem", color: INK }}
                >
                  {po.vendorName || "—"}
                </Typography>
                <Typography sx={{ fontSize: "0.74rem", color: SUB }}>
                  {[
                    po.vendorGST && `GST ${po.vendorGST}`,
                    po.vendorPAN && `PAN ${po.vendorPAN}`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "GST / PAN not on file"}
                </Typography>
                {po.vendorAddress && (
                  <Typography sx={{ fontSize: "0.74rem", color: SUB }}>
                    {po.vendorAddress}
                  </Typography>
                )}
                <Typography sx={{ fontSize: "0.74rem", color: SUB }}>
                  {[po.vendorPhone, po.vendorEmail].filter(Boolean).join(" · ")}
                </Typography>
              </Box>
            </Stack>
          </Section>

          <Section title="Order details">
            <Box
              sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}
            >
              <Fact label="PO Date" value={fmtDate(po.poDate)} />
              <Fact
                label="Expected Delivery"
                value={
                  po.expectedDeliveryDate
                    ? fmtDate(po.expectedDeliveryDate)
                    : ""
                }
              />
              <Fact label="Lead Time" value={po.leadTime} />
              <Fact
                label="Payment Terms"
                value={
                  po.paymentTerms ||
                  (po.creditPeriod ? `${po.creditPeriod} days credit` : "")
                }
              />
              <Fact label="Indent" value={indents} />
              <Fact
                label="Format"
                value={
                  PO_FORMAT_LABEL[po.poFormatType] || PO_FORMAT_LABEL.OTHER
                }
              />
              {po.deliveryTerms && (
                <Box sx={{ gridColumn: "1 / -1" }}>
                  <Fact label="Delivery Terms" value={po.deliveryTerms} />
                </Box>
              )}
            </Box>
          </Section>

          <Section title={`Items (${items.length})`}>
            {isLoading && !items.length ? (
              <CircularProgress size={18} />
            ) : (
              items.map((it, i) => (
                <ItemRow key={it._id || i} it={it} jsl={jsl} first={i === 0} />
              ))
            )}
            <Box sx={{ mt: 1, pt: 1, borderTop: `1px dashed ${LINE}` }}>
              {!jsl && (
                <>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography sx={{ fontSize: "0.78rem", color: SUB }}>
                      Taxable value
                    </Typography>
                    <Typography sx={{ fontSize: "0.78rem", fontWeight: 700 }}>
                      {fmtINR(po.totalTaxableValue)}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography sx={{ fontSize: "0.78rem", color: SUB }}>
                      GST
                    </Typography>
                    <Typography sx={{ fontSize: "0.78rem", fontWeight: 700 }}>
                      {fmtINR(po.totalGSTAmount)}
                    </Typography>
                  </Stack>
                </>
              )}
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mt: 0.5 }}
              >
                <Typography
                  sx={{ fontSize: "0.86rem", fontWeight: 800, color: INK }}
                >
                  Grand total
                </Typography>
                <Typography
                  sx={{ fontSize: "1rem", fontWeight: 800, color: BLUE }}
                >
                  {fmtINR(po.grandTotal)}
                </Typography>
              </Stack>
            </Box>
          </Section>

          {po.remarks && (
            <Section title="Remarks on the PO">
              <Typography
                sx={{
                  fontSize: "0.8rem",
                  color: "#334155",
                  whiteSpace: "pre-wrap",
                }}
              >
                {po.remarks}
              </Typography>
            </Section>
          )}
        </Stack>

        {/* PDF */}
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            minHeight: { xs: "70vh", md: 0 },
            bgcolor: "#eef2f7",
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{
              px: 2,
              py: 1,
              bgcolor: "#fff",
              borderBottom: `1px solid ${LINE}`,
            }}
          >
            <FileText size={16} color="#dc2626" />
            <Typography
              sx={{
                flex: 1,
                minWidth: 0,
                fontSize: "0.82rem",
                fontWeight: 800,
                color: INK,
              }}
              noWrap
            >
              PO PDF{" "}
              <Typography
                component="span"
                sx={{ fontSize: "0.74rem", color: SUB, fontWeight: 600 }}
              >
                · preview of {poDisplayNumber(po)}
              </Typography>
            </Typography>
            <Tooltip title="Open in a new tab">
              <span>
                <IconButton
                  size="small"
                  href={pdf.url || undefined}
                  target="_blank"
                  rel="noopener"
                  disabled={!pdf.url}
                >
                  <ExternalLink size={16} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Download">
              <span>
                <IconButton
                  size="small"
                  href={pdf.url || undefined}
                  download={pdfName}
                  disabled={!pdf.url}
                >
                  <Download size={16} />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
          <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
            {pdf.url ? (
              <iframe
                title="PO PDF preview"
                src={pdf.url}
                style={{ border: 0, width: "100%", flexGrow: 1 }}
              />
            ) : (
              <Box
                sx={{
                  flexGrow: 1,
                  display: "grid",
                  placeItems: "center",
                  p: 3,
                  textAlign: "center",
                }}
              >
                {pdf.loading ? (
                  <Box>
                    <CircularProgress size={28} />
                    <Typography
                      sx={{ mt: 1.25, fontSize: "0.84rem", color: SUB }}
                    >
                      Preparing the PO PDF…
                    </Typography>
                  </Box>
                ) : (
                  <Box>
                    <AlertTriangle size={30} color="#b45309" />
                    <Typography
                      sx={{
                        mt: 1,
                        fontSize: "0.86rem",
                        fontWeight: 700,
                        color: INK,
                      }}
                    >
                      The PDF could not be shown
                    </Typography>
                    <Typography
                      sx={{ fontSize: "0.78rem", color: SUB, maxWidth: 360 }}
                    >
                      {pdf.error}. The details on the left are what you approve.
                    </Typography>
                    <Button
                      size="small"
                      startIcon={<RefreshCw size={14} />}
                      onClick={pdf.retry}
                      sx={{ mt: 1, fontWeight: 700 }}
                    >
                      Try again
                    </Button>
                  </Box>
                )}
              </Box>
            )}
          </Box>
        </Box>
        {pendingRates.length > 0 && (
          <Alert
            severity="warning"
            data-testid="po-approval-rate-hold"
            sx={{ mb: 2 }}
          >
            {pendingRates.length} rate change
            {pendingRates.length === 1 ? "" : "s"} (
            {pendingRates.map((it) => it.rateChangeRequestNumber).join(", ")})
            await approval in Purchase Approval — this PO can be approved once{" "}
            {pendingRates.length === 1 ? "it is" : "they are"} decided.
          </Alert>
        )}
        <TextField
          label="Remarks"
          fullWidth
          multiline
          minRows={2}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Optional approval / rejection note"
        />
      </DialogContent>

      <DialogActions
        sx={{
          px: 2.5,
          py: 1.5,
          gap: 1,
          borderTop: `1px solid ${LINE}`,
          flexWrap: { xs: "wrap", sm: "nowrap" },
        }}
      >
        <TextField
          size="small"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Note with your decision (optional) — e.g. why it is rejected"
          sx={{ flex: 1, minWidth: { xs: "100%", sm: 240 }, mr: 1 }}
          inputProps={{ maxLength: 1000 }}
        />
        <Button
          onClick={() => onClose(false)}
          disabled={deciding}
          sx={{ fontWeight: 700 }}
        >
          Cancel
        </Button>
        <Button
          color="error"
          variant="outlined"
          startIcon={<XCircle size={16} />}
          onClick={() => decide("REJECTED")}
          disabled={deciding}
          sx={{ fontWeight: 700 }}
        >
          Reject
        </Button>
        <Button
          color="success"
          variant="contained"
          startIcon={
            isLoading ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <CheckCircle2 size={16} />
            )
          }
          onClick={() => decide("APPROVED")}
          disabled={isLoading || pendingRates.length > 0}
          data-testid="po-approve-confirm"
        >
          Approve
        </Button>
      </DialogActions>
    </>
  );
};

// The form lives inside the Dialog, so it starts fresh each time the dialog opens.
const PurchaseOrderApprovalDialog = ({ open, onClose, po }) => {
  const [approvePo, { isLoading }] = useApprovePurchaseOrderMutation();
  return (
    <Dialog
      open={open}
      onClose={() => !isLoading && onClose?.(false)}
      maxWidth="xl"
      fullWidth
      PaperProps={{
        sx: {
          height: { xs: "100%", md: "92vh" },
          maxHeight: { xs: "100%", md: "92vh" },
          m: { xs: 0, md: 4 },
          borderRadius: { xs: 0, md: 3 },
          maxWidth: 1280,
        },
      }}
    >
      {po ? (
        <ApprovalForm
          po={po}
          approvePo={approvePo}
          deciding={isLoading}
          onClose={(done) => onClose?.(done)}
        />
      ) : null}
    </Dialog>
  );
};

export default PurchaseOrderApprovalDialog;
