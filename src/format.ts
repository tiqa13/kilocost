let currency = "USD";
let usdToDisplay = 1;
let rateNote = "";
let formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function setDisplay(currencyCode: string, factor: number, note: string): void {
  usdToDisplay = factor;
  rateNote = note;
  try {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    currency = currencyCode;
  } catch {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    currency = "USD";
    usdToDisplay = 1;
    rateNote = `unknown currency ${currencyCode} — showing USD`;
  }
}

export function getDisplay(): { currency: string; usdToDisplay: number; note: string } {
  return { currency, usdToDisplay, note: rateNote };
}

export function getCurrency(): string {
  return currency;
}

export function getRateNote(): string {
  return rateNote;
}

/** value is a USD-basis cost; converts to display currency. */
export function money(usdValue: number): string {
  return formatter.format(usdValue * usdToDisplay);
}
