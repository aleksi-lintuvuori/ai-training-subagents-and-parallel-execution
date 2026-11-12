export interface Expense {
  id: number;
  description: string;
  amount: number;
  date: string;
  created_at: string;
  category_id: number | null;
}

export interface Category {
  id: number;
  name: string;
  monthly_limit: number;
  spent_this_month: number;
}

export interface ReportEntry {
  categoryId: number;
  categoryName: string;
  monthlyLimit: number;
  spent: number;
  remaining: number;
}

export interface MonthlySummary {
  month: string;
  entries: ReportEntry[];
  /** Spending on expenses with no category; included in totalSpent. */
  uncategorisedSpent: number;
  /** All spending in the month, categorised and uncategorised. */
  totalSpent: number;
}
