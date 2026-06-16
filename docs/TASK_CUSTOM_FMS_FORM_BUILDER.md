# Developer Assessment Task — Custom FMS / O2D Workflow Engine (MERN)

**Role:** Full-Stack MERN Developer
**Stack (mandatory):** MongoDB · Express · React · Node + **Redux Toolkit & RTK Query**
**Estimated effort:** 4–6 days
**Submission:** GitHub repo + short README + 3–5 min demo video (Loom/screen recording)

---

## 1. What you are building

Build a **custom, self-designed FMS (Flow Management System)** for an ERP flow such as **O2D (Order-to-Delivery)**.

The idea: an **Admin** designs a workflow with **zero code** — they create the **steps** of a process, build a **custom form** for each step, and attach that form to the step. A **Doer** (worker) then runs the workflow for real orders, opens each step, fills its form, and ticks its checklist. Everyone can watch progress in an **FMS Tracker** that shows every order **step by step**.

You are building the whole thing: backend, frontend, auth, and data model.

---

## 2. Core features (what we will test)

### A. Authentication & two roles
- User **registration & login** (JWT).
- Exactly two roles: **ADMIN** and **DOER**.
- **Doers register** and can be **assigned to steps**, with an optional **Buddy** (a backup doer who can also action the step).
- ADMIN-only screens must be blocked for DOER (route guard + API guard).

### B. Step Builder (Admin)
- Admin creates an ordered list of **Steps** for a flow (e.g. Order Entry → Planning → Dispatch → Invoice → Delivery).
- Each step has: name, sequence/order, description, an **assigned Doer**, an optional **Buddy**, and an **SLA / due-time** (e.g. "2 hours", "1 day").

### C. Form Builder (Admin) — main challenge
- Admin **designs a custom form** (no code) and **attaches it to a step**.
- Must support at least these field types: **Text, Number, Date, Dropdown/Select, Checkbox, and File Attachment**.
- Each field configurable: label, required/optional, and (for select) its options.
- Forms are **reusable** and **editable**.

### D. Run the flow + Doer task entry
- Admin starts the flow for an **Order** (e.g. by Order/SO number).
- Each step is **auto-assigned** to its Doer (and Buddy).
- The Doer opens their step, **fills the attached form**, uploads any attachment, ticks the checklist, and **submits** → step is marked **Done**.
- A step cannot be completed until its **required fields** and **required checklist items** are filled.

### E. FMS Tracker (everyone)
- A view listing **every Order** and its flow progress **step by step**: which steps are Done / Pending / Overdue, who the doer is, when it was done, and the **submitted form data** (read-only).
- Show delay vs SLA (late or on-time).

---

## 3. Suggested data model (you may refine)

```
User      { name, email, passwordHash, role: 'ADMIN' | 'DOER' }

Step      { name, order, description, assigneeId, buddyId, slaMinutes, formId }

Form      { title, fields: [
              { key, label, type: TEXT|NUMBER|DATE|SELECT|CHECKBOX|FILE,
                required, options[] }
          ] }

Order     { orderNo, partyName, createdBy }

Process   { orderId, steps: [
              { stepId, status: PENDING|DONE|OVERDUE,
                assigneeId, buddyId, plannedAt, completedAt,
                formSubmission: { values{}, attachments[] },
                completedBy }
          ] }
```

---

## 4. Technical requirements (must-have)

| Area | Requirement |
|---|---|
| **Frontend state** | **Redux Toolkit + RTK Query** for all server data (no raw axios in components) |
| **Auth** | JWT, hashed passwords (bcrypt), protected routes both client & server |
| **Validation** | Server-side validation on every write (express-validator / Zod / Joi) |
| **File upload** | Multer (local disk is fine) or any cloud bucket for FILE fields |
| **Dynamic form** | One renderer component that builds the form from the Form definition — **not** a hardcoded form |
| **Code quality** | Clear folder structure, meaningful names, error handling, no secrets committed |
| **README** | Setup steps, env vars, seed/test ADMIN login, and any assumptions |

---

## 5. Nice-to-have (bonus — not required)

- Conditional fields (show field B only if field A = X).
- Drag-and-drop step / field ordering (`@dnd-kit`).
- Email or in-app notification when a step is assigned or overdue.
- A simple dashboard: count of pending / overdue steps per doer.
- Form versioning (editing a form doesn't change already-submitted data).
- Deployed live link (Render / Vercel / Railway).

---

## 6. Acceptance criteria (how we score)

1. ✅ A user can **register/login**; ADMIN and DOER see different menus and are correctly guarded.
2. ✅ ADMIN can **create steps**, assign a **Doer + Buddy**, and set an SLA.
3. ✅ ADMIN can **design a custom form** (≥5 field types incl. file) and **attach it to a step**.
4. ✅ Starting a flow for an order **auto-assigns** every step to its doer/buddy.
5. ✅ A DOER can open a step, **fill the dynamic form**, upload a file, and **submit**; required fields are enforced.
6. ✅ The **FMS Tracker** shows each order's progress **step by step** with submitted data and on-time/late status.
7. ✅ All server data flows through **RTK Query**; APIs are protected and validated.

---

## 7. Scoring rubric (100 pts)

| Criteria | Points |
|---|---|
| Auth + 2 roles + route/API guards | 15 |
| Step Builder (CRUD, assignment, buddy, SLA) | 15 |
| **Form Builder + dynamic renderer** | 25 |
| Run flow + Doer entry + completion gating | 15 |
| FMS Tracker (step-by-step + submitted data + SLA) | 15 |
| Code quality, structure, RTK Query usage, README | 15 |
| **Bonus features** | +10 |

---

## 8. Deliverables

1. **GitHub repo** — `backend/` + `frontend/`, with `.env.example`.
2. **README** — how to run, seed an ADMIN, and test the full flow.
3. **Short demo video** showing: admin builds a step + form → runs a flow → doer fills it → tracker updates.

> **Tip:** We care most about the **Form Builder + dynamic form rendering** and clean **RTK Query** usage. A focused, working flow beats a half-finished feature-rich app.
```
