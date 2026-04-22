import PasswordGate from "@/components/accountant/PasswordGate";
import AccountantDashboardClient from "@/components/accountant/AccountantDashboardClient";

export const dynamic = "force-dynamic";

export default function AccountantPage() {
  return (
    <PasswordGate>
      <AccountantDashboardClient />
    </PasswordGate>
  );
}
