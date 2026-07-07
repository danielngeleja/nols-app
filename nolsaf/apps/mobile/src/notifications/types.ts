export type NotificationItem = {
  id: number | string;
  title: string;
  body: string;
  createdAt: string;
  unread: boolean;
  meta?: any;
};

export type NotificationListResponse = {
  items: NotificationItem[];
  total?: number;
  totalUnread?: number;
};
