import NotificationSoundSettings from "./notification-sound-settings";

export default function AccountLayout({children}:{children:React.ReactNode}){
  return <>{children}<NotificationSoundSettings/></>;
}
