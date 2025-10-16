export interface OdooProduct {
  id: number;
  name: string;
  price: number;
  stock: number;
  description?: string;
  category?: string;
}

export interface OdooOrder {
  id: number;
  orderNumber: string;
  status: string;
  items: OdooOrderItem[];
  total: number;
  customer: OdooCustomer;
  createdAt: Date;
}

export interface OdooOrderItem {
  productId: number;
  productName: string;
  quantity: number;
  price: number;
}

export interface OdooCustomer {
  id: number;
  name: string;
  email: string;
  phone?: string;
}

export interface OdooToolInput {
  action: 'getProduct' | 'getOrder' | 'searchProducts' | 'getOrdersByCustomer';
  params: Record<string, any>;
}
