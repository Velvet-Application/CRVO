import DashboardPeriodFilter from "./dashboard-period-filter";
import DashboardSectionNav from "./dashboard-section-nav";
import HomeDashboard from "./home-dashboard";

export default function Page(){
  return <><DashboardSectionNav/><HomeDashboard/><DashboardPeriodFilter/></>;
}
