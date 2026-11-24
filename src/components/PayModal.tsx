import { useRef } from 'react';
import { Modal } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import PaymentForm from './PaymentForm';

interface PayModalProps {
  opened: boolean;
  onClose: () => void;
  initialAmount?: number;
}

export default function PayModal({ opened, onClose, initialAmount = 100 }: PayModalProps) {
  const rememberedChannel = useRef<string | null>(null);
  const { t } = useTranslation();
  return <Modal opened={opened} onClose={onClose} title={t('payments.topUpBalance')}>
    {opened && <PaymentForm initialAmount={initialAmount} rememberedChannel={rememberedChannel} manageSaved onCancel={onClose} onComplete={onClose} />}
  </Modal>;
}
