import { ROLES } from "../constants.js";

export function canEditOrders(role) {
  return role === ROLES.ADMIN || role === ROLES.SALES;
}

export function canAssignOrderMachine(role) {
  return role === ROLES.ADMIN || role === ROLES.PRODUCTION;
}

export function canOpenMachine(role) {
  return role === ROLES.ADMIN || role === ROLES.PRODUCTION || role === ROLES.INSTALLATION;
}

export function canOpenOrder(role) {
  return (
    role === ROLES.ADMIN ||
    role === ROLES.SALES ||
    role === ROLES.PRODUCTION ||
    role === ROLES.INSTALLATION
  );
}
