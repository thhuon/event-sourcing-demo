//////////////////////////////////////
/// Product Items
//////////////////////////////////////

import { ShoppingCartErrors } from './shoppingCart';

export interface ProductItem {
  productId: number;
  quantity: number;
}

export interface PricedProductItem {
  productId: number;
  quantity: number;
  sku: string;
  price: number;
  discount: number;
}

export const addProductItem = (
  productItems: PricedProductItem[],
  newProductItem: PricedProductItem,
): PricedProductItem[] => {
  const { productId, quantity } = newProductItem;

  const currentProductItem = findProductItem(productItems, productId);

  if (!currentProductItem) return [...productItems, newProductItem];

  const newQuantity = currentProductItem.quantity + quantity;
  const mergedProductItem = { ...currentProductItem, quantity: newQuantity };

  return productItems.map((pi) =>
    pi.productId === productId ? mergedProductItem : pi,
  );
};

export const removeProductItem = (
  productItems: PricedProductItem[],
  newProductItem: PricedProductItem,
): PricedProductItem[] => {
  const { productId, quantity } = newProductItem;

  const currentProductItem = assertProductItemExists(
    productItems,
    newProductItem,
  );

  const newQuantity = currentProductItem.quantity - quantity;

  if (newQuantity === 0)
    return productItems.filter((pi) => pi.productId !== productId);

  const mergedProductItem = { ...currentProductItem, quantity: newQuantity };

  return productItems.map((pi) =>
    pi.productId === productId ? mergedProductItem : pi,
  );
};

export const findProductItem = (
  productItems: PricedProductItem[],
  productId: number,
): PricedProductItem | undefined => {
  return productItems.find((pi) => pi.productId === productId);
};

export const assertProductItemExists = (
  productItems: PricedProductItem[],
  { productId, quantity }: ProductItem,
): PricedProductItem => {
  const current = findProductItem(productItems, productId);

  if (!current || current.quantity < quantity) {
    throw new Error(ShoppingCartErrors.PRODUCT_ITEM_NOT_FOUND);
  }

  return current;
};

//////////////////////////////////////
/// Price list
//////////////////////////////////////

export interface Product {
  productId: number;
  sku: string;
  name: string;
  price: number;
}

export const products: Product[] = [
  { productId: 1, sku: 'TSHIRT', name: 'Áo thun', price: 150000 },
  { productId: 2, sku: 'JEANS', name: 'Quần jean', price: 450000 },
  { productId: 3, sku: 'SNEAKER', name: 'Giày sneaker', price: 900000 },
  { productId: 4, sku: 'CAP', name: 'Mũ lưỡi trai', price: 120000 },
];

export const getPricedProductItem = (productItem: ProductItem) => {
  const product = products.find((p) => p.productId === productItem.productId);

  if (!product) {
    return Promise.reject(new Error(ShoppingCartErrors.PRODUCT_ITEM_NOT_FOUND));
  }

  const pricedItem: PricedProductItem = {
    ...productItem,
    discount: 0,
    price: product.price,
    sku: product.sku,
  };

  return Promise.resolve(pricedItem);
};
