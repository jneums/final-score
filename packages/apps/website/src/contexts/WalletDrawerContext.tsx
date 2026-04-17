import { createContext, useContext, useState, ReactNode } from 'react';

interface WalletDrawerContextType {
  isOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
}

const WalletDrawerContext = createContext<WalletDrawerContextType | undefined>(undefined);

export function WalletDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const openDrawer = () => setIsOpen(true);
  const closeDrawer = () => setIsOpen(false);
  const toggleDrawer = () => setIsOpen(prev => !prev);

  return (
    <WalletDrawerContext.Provider value={{ isOpen, openDrawer, closeDrawer, toggleDrawer }}>
      {children}
    </WalletDrawerContext.Provider>
  );
}

export function useWalletDrawer() {
  const context = useContext(WalletDrawerContext);
  if (context === undefined) {
    throw new Error('useWalletDrawer must be used within a WalletDrawerProvider');
  }
  return context;
}
