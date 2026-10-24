import { Route, Routes } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import OrdersList from "../pages/OrdersList.jsx";
import OrderDetail from "../pages/OrderDetail.jsx";
import MachineDetail from "../pages/MachineDetail.jsx";
import Dashboard from "../pages/Dashboard.jsx";
import PartsPage from "../pages/PartsPage.jsx";
import ReviveQueuePage from "../pages/ReviveQueuePage.jsx";
import { ROLES, emptyResistanceRows } from "../constants.js";
import { previewParts, previewQueue, previewReturnMachines } from "./refurbSample.js";

// Dev-only sample screens. main.jsx loads this only when import.meta.env.DEV
// is true, so the production GitHub Pages bundle does not include it.
const packed = {
  machineBolted: { url: "preview" },
  fastnersBox: { url: "preview" },
  frontCover: { url: "preview" },
  finalPacked: { url: "preview" },
};

function stamp(iso) {
  return { toDate: () => new Date(`${iso}T00:00:00`) };
}

const machines = [
  {
    id: "m50",
    machineNumber: "X33M050",
    groupNumber: "",
    finalPacking: packed,
    dispatch: { dispatched: false, date: "", comment: "", includeStand: false },
    delivery: { delivered: false },
    installation: { installed: false },
    sectionMeta: { finalPacking: { updatedAt: stamp("2026-10-22"), updatedBy: "production@example.com" } },
  },
  {
    id: "m51",
    machineNumber: "X33M051",
    groupNumber: "",
    finalPacking: packed,
    dispatch: { dispatched: false },
    delivery: { delivered: false },
    installation: { installed: false },
    sectionMeta: { finalPacking: { updatedAt: stamp("2026-10-22") } },
  },
  {
    id: "m52",
    machineNumber: "X33M052",
    groupNumber: "",
    finalPacking: packed,
    dispatch: { dispatched: false },
    delivery: { delivered: false },
    installation: { installed: false },
    sectionMeta: { finalPacking: { updatedAt: stamp("2026-10-23") } },
  },
  {
    id: "m47",
    machineNumber: "X33M047",
    groupNumber: "G1443",
    resistance: emptyResistanceRows(),
    finalPacking: packed,
    dispatch: {
      dispatched: true,
      date: "2026-10-21",
      comment: "Include machine stand with this dispatch",
      includeStand: true,
      courier: "Safexpress",
      trackingNumber: "18471189815",
      accessoriesSeparate: true,
      accessoriesCourier: "Delhivery",
      accessoriesTracking: "2780 4413 096",
      accessoriesSentOn: "2026-10-22",
      accessoriesStatus: "In transit",
    },
    delivery: { delivered: false },
    installation: { installed: false },
    sectionMeta: {
      dispatch: { updatedBy: "production@example.com", updatedAt: stamp("2026-10-21") },
    },
    warranty: { extensions: [] },
  },
  ...previewReturnMachines,
];

const orders = [
  {
    id: "G1459",
    groupNumber: "G1459",
    status: "Pause Shipment",
    payment: "Advance",
    orderDate: "2026-10-22",
    customer: "Gurminder",
    city: "New Delhi",
    contact: "9810011122",
    address: "14 Ring Road",
    machineId: "",
    machineNumber: "",
    tab: "No",
    accessories: "Yes",
    hanger: "No",
    bench: "NONE",
    glassMetal: "Metal",
    warranty: "Default, 1 year total warranty",
    orderType: "Personal use",
    comments: "",
  },
  {
    id: "G1458",
    groupNumber: "G1458",
    status: "Please Ship",
    payment: "COD",
    orderDate: "2026-10-22",
    customer: "Dr Shouvick",
    city: "Kolkata",
    contact: "9836600082",
    address: "\"The Ecos\", Tower 2, Flat 1, Near Gate No. 1, Eco Park, New Town, Kolkata, West Bengal 700161",
    comments: "COD ₹74,999 (₹97,000 total) paid 22 Oct via Cashfree",
    orderType: "Personal use",
    warranty: "Default, 1 year total warranty",
    tab: "No",
    accessories: "Yes",
    hanger: "Yes",
    bench: "NONE",
    glassMetal: "Metal",
    machineId: "",
    machineNumber: "",
  },
  {
    id: "G1446",
    groupNumber: "G1446",
    status: "Please Ship",
    payment: "Advance",
    orderDate: "2026-10-21",
    customer: "Sudhir",
    city: "Mumbai",
    contact: "9820011122",
    machineId: "m49",
    machineNumber: "X33M049",
    fulfillmentStatus: "Packed",
    tab: "No",
    accessories: "Yes",
    hanger: "Yes",
    bench: "NONE",
    glassMetal: "Metal",
    warranty: "Default, 1 year total warranty",
  },
  {
    id: "G1443",
    groupNumber: "G1443",
    status: "Please Ship",
    payment: "Paid",
    orderDate: "2026-10-19",
    customer: "Hemant",
    city: "Pune",
    contact: "9115000070",
    address: "Pune",
    comments: "Accessories · Hanger · Metal",
    machineId: "m47",
    machineNumber: "X33M047",
    fulfillmentStatus: "Dispatched",
    tab: "No",
    accessories: "Yes",
    hanger: "Yes",
    bench: "NONE",
    glassMetal: "Metal",
    warranty: "Default, 1 year total warranty",
    orderType: "Personal use",
  },
  {
    id: "G1440",
    groupNumber: "G1440",
    status: "Please Ship",
    payment: "Paid",
    orderDate: "2026-10-19",
    customer: "Vaibhav",
    city: "Mumbai",
    contact: "9800012345",
    machineId: "m48",
    machineNumber: "X33M048",
    fulfillmentStatus: "Dispatched",
    accessories: "Yes",
    hanger: "No",
    glassMetal: "Metal",
    warranty: "Default, 1 year total warranty",
  },
  {
    id: "G1434",
    groupNumber: "G1434",
    status: "Please Ship",
    payment: "Paid",
    orderDate: "2026-10-15",
    customer: "Chetan",
    city: "Bangalore",
    contact: "9900011111",
    machineNumber: "X33M043",
    fulfillmentStatus: "Installed",
    accessories: "Yes",
    glassMetal: "Metal",
    warranty: "Default, 1 year total warranty",
  },
  {
    id: "G1433C",
    groupNumber: "G1433C",
    status: "Cancelled",
    payment: "Cancelled",
    orderDate: "2026-08-17",
    customer: "Suresh",
    city: "Madurai",
    contact: "9440011122",
    machineId: "",
    machineNumber: "",
  },
];

function ordersList() {
  return <OrdersList orders={orders} machines={machines} role={ROLES.ADMIN} />;
}

function orderDetail(creating = false) {
  return (
    <OrderDetail
      orders={orders}
      machines={machines}
      role={ROLES.ADMIN}
      currentUserEmail="production@example.com"
      creating={creating}
    />
  );
}

function machineDetail() {
  return (
    <MachineDetail
      machines={machines}
      orders={orders}
      standCount={6}
      tickets={[]}
      role={ROLES.ADMIN}
      currentUserEmail="production@example.com"
      parts={previewParts}
      preview
    />
  );
}

function dashboard() {
  return (
    <Dashboard
      machines={machines}
      loading={false}
      tickets={[]}
      role={ROLES.ADMIN}
      currentUserEmail="production@example.com"
      standCount={6}
      reviveQueueCount={previewQueue.filter((item) => item.status === "queued").length}
    />
  );
}

export default function PreviewApp() {
  return (
    <Layout role={ROLES.ADMIN} userEmail="production@example.com" missingCount={0}>
      <Routes>
        <Route path="/__preview/orders" element={ordersList()} />
        <Route path="/__preview/orders/new" element={orderDetail(true)} />
        <Route path="/__preview/orders/:groupNumber" element={orderDetail()} />
        <Route path="/__preview/machine/:id" element={machineDetail()} />
        <Route path="/__preview" element={dashboard()} />
        <Route path="/__preview/parts" element={<PartsPage parts={previewParts} role={ROLES.ADMIN} currentUserEmail="admin@example.com" preview />} />
        <Route path="/__preview/revive" element={<ReviveQueuePage items={previewQueue} currentUserEmail="production@example.com" preview />} />
        {/* Same paths the real pages link to, so clicks stay inside this preview. */}
        <Route path="/orders" element={ordersList()} />
        <Route path="/orders/new" element={orderDetail(true)} />
        <Route path="/orders/:groupNumber" element={orderDetail()} />
        <Route path="/machine/:id" element={machineDetail()} />
        <Route path="/" element={dashboard()} />
        <Route path="/parts" element={<PartsPage parts={previewParts} role={ROLES.ADMIN} currentUserEmail="admin@example.com" preview />} />
        <Route path="/revive" element={<ReviveQueuePage items={previewQueue} currentUserEmail="production@example.com" preview />} />
      </Routes>
    </Layout>
  );
}
