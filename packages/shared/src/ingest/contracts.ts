import type { FileType } from "./types";

export interface FileContract {
  /** Exact required headers, in the order the PRD documents them. Extra
   * columns in the source file are ignored. */
  columns: readonly string[];
  dateColumns: readonly string[];
  moneyColumns: readonly string[];
  qtyColumns: readonly string[];
}

// PRD §6 F2 file contracts — exact required headers per upload type.
export const FILE_CONTRACTS: Record<FileType, FileContract> = {
  purchase_orders: {
    columns: [
      "po_number",
      "po_date",
      "supplier_code",
      "material_code",
      "plant_code",
      "qty_mt",
      "unit_price_inr",
      "delivery_date",
    ],
    dateColumns: ["po_date", "delivery_date"],
    moneyColumns: ["unit_price_inr"],
    qtyColumns: ["qty_mt"],
  },
  consumption: {
    columns: ["date", "material_code", "plant_code", "qty_mt"],
    dateColumns: ["date"],
    moneyColumns: [],
    qtyColumns: ["qty_mt"],
  },
  market_prices: {
    columns: ["date", "source", "grade_family", "price_inr_mt"],
    dateColumns: ["date"],
    moneyColumns: ["price_inr_mt"],
    qtyColumns: [],
  },
  inventory: {
    columns: ["as_of_date", "material_code", "plant_code", "qty_mt"],
    dateColumns: ["as_of_date"],
    moneyColumns: [],
    qtyColumns: ["qty_mt"],
  },
};
