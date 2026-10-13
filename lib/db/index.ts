import bcrypt from "bcryptjs";
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "crypto";
import { getCodeSecret, signToken } from "@/lib/auth";
import { normalizeTajikPhone } from "@/lib/phone";
import { createClient } from '@libsql/client';
import { db } from "./client";
import { initializeDatabase } from "./seed";

export type UserRole = "USER" | "ADMIN" | "DEALER" | "DISTRIBUTOR";
export type Category = { id:string; slug:string; name:string; subtitle:string; description:string; image:string; sort:number; status:"published"|"draft"; parentId:string|null };
export type ItemType = "product" | "service";
export const SERVICE_VIRTUAL_STOCK = 9999; // услуги не имеют остатка: витрина считает их всегда доступными
export type Product = { id:string; slug:string; name:string; shortDescription:string; description:string; sku:string; brand:string; images:string[]; specifications:Record<string,string>; price:number; previousPrice:number|null; image:string; sourceUrl?:string; categoryId:string; featured:number; rating:number; stock:number; isPublished:number; type:ItemType; createdAt:string; categoryName?:string; categorySlug?:string };
export type User = { id:string; firstName:string; lastName:string; email:string; phone:string; passwordHash:string; role:UserRole; avatar:string|null; emailVerified:number; isBlocked:number; createdAt:string };
export type ActivityLog = { id:string; actorId:string|null; action:string; message:string; createdAt:string };
export const contactMessageStatuses=["NEW","READ","ANSWERED"] as const;
export type ContactMessageStatus=(typeof contactMessageStatuses)[number];
export type ContactMessage={id:string;name:string;email:string;phone:string;message:string;status:ContactMessageStatus;reply:string;replyText:string;isReplied:boolean;repliedAt:string|null;createdAt:string};
export const orderStatusValues=["new","processing","completed","cancelled"] as const;
export type OrderStatus=(typeof orderStatusValues)[number];
export type CartLine=Product & {quantity:number;categorySlug:string;categoryName:string};
export type CheckoutItem={productId:string;quantity:number};
export type OrderItem={id:string;orderId:string;productId:string|null;sku:string;name:string;image:string;unitPrice:number;quantity:number;lineTotal:number};
export type Order={id:string;orderNumber:string|null;userId:string|null;firstName:string;lastName:string;phone:string;address:string;city:string;email:string;comment:string;total:number;status:OrderStatus;createdAt:string;items:OrderItem[]};
export class StoreError extends Error { status:number; constructor(message:string,status=400){super(message);this.status=status;} }
export const REQUESTED_ADMIN_EMAIL="najmiddinovavasto5@gmail.com";

async function ready(){ await initializeDatabase(); }
const row = <T>(x: unknown) => x as T;
const now=()=>new Date().toISOString();
function parseJson<T>(v:unknown,f:T):T { try{return v ? JSON.parse(String(v)) as T:f}catch{return f} }

export function getSiteUrl(request?:Request){const e=process.env.NEXT_PUBLIC_SITE_URL?.trim();if(e)return e.replace(/\/$/,"");if(process.env.VERCEL_URL)return `https://${process.env.VERCEL_URL}`;if(request)try{return new URL(request.url).origin}catch{}return ""}
export function apiUrl(path:string,request?:Request){return `${getSiteUrl(request)}${path.startsWith("/")?path:`/${path}`}`}
export function legacyOrderStatus(s:string):OrderStatus|null{return ({new:"new",pending:"new",confirmed:"processing",processing:"processing",shipped:"processing",completed:"completed",cancelled:"cancelled"} as Record<string,OrderStatus>)[s]||null}
export function isReadOnlyMode(){return false}
export function getDatabaseMode():"file"|"memory"|"seed-only"{return "file"}
export function isDatabaseFallback(){return false}
export function getDatabaseInitError(){return null}
export function getDb(){return db}
export async function ensureSeedAdmin(){await ready()}

export async function getCategories():Promise<Category[]>{await ready();const r=await db.execute(`SELECT * FROM categories WHERE status='published' ORDER BY sort ASC,name ASC`);return r.rows as unknown as Category[]}
export async function getAdminCategories():Promise<Category[]>{await ready();const r=await db.execute(`SELECT * FROM categories ORDER BY sort ASC,name ASC`);return r.rows as unknown as Category[]}
export async function getCategoryBySlug(slug:string){await ready();const r=await db.execute({sql:`SELECT * FROM categories WHERE slug=? LIMIT 1`,args:[slug]});return r.rows[0]?row<Category>(r.rows[0]):undefined}
export async function createCategory(p:{name:string;slug:string;subtitle?:string;description?:string;image?:string;sort?:number;status?:"published"|"draft";parentId?:string|null}){
  await ready();
  const parentId=p.parentId||null;
  await assertValidParent(null,parentId);
  const id=randomUUID();
  await db.execute({sql:`INSERT INTO categories(id,slug,name,subtitle,description,image,sort,status,parentId) VALUES(?,?,?,?,?,?,?,?,?)`,args:[id,p.slug,p.name,p.subtitle||"",p.description||"",p.image||"",p.sort??0,p.status||"published",parentId]});
  return getCategoryBySlug(p.slug);
}
/** Допускается ровно два уровня: главная категория → подкатегория. */
async function assertValidParent(id:string|null,parentId:string|null|undefined){
  if(!parentId)return;
  if(parentId===id)throw new StoreError("Категория не может быть вложена сама в себя.",400);
  const parent=await getCategoryById(parentId);
  if(!parent)throw new StoreError("Родительская категория не найдена.",404);
  if(parent.parentId)throw new StoreError("Допускается только два уровня: подкатегорию нельзя сделать родительской.",400);
  if(id){
    const kids=await db.execute({sql:`SELECT COUNT(*) AS c FROM categories WHERE parentId=?`,args:[id]});
    if(Number(kids.rows[0]?.c||0))throw new StoreError("У этой категории есть подкатегории — её нельзя вложить в другую.",409);
  }
}
export async function updateCategoryById(id:string,p:Partial<Category>){
  await ready();
  if(p.parentId!==undefined)await assertValidParent(id,p.parentId||null);
  const allowed=["slug","name","subtitle","description","image","sort","status","parentId"] as const;
  const sets:string[]=[];const args:(string|number|null)[]=[];
  for(const k of allowed)if(p[k]!==undefined){sets.push(`${k}=?`);args.push(k==="parentId"?(p.parentId||null):(p[k] as never))}
  if(!sets.length)return getCategoryById(id);
  args.push(id);
  await db.execute({sql:`UPDATE categories SET ${sets.join(",")} WHERE id=?`,args});
  return getCategoryById(id);
}
async function getCategoryById(id:string){const r=await db.execute({sql:`SELECT * FROM categories WHERE id=?`,args:[id]});return r.rows[0]?row<Category>(r.rows[0]):undefined}
export async function deleteCategoryById(id:string){
  await ready();
  const kids=await db.execute({sql:`SELECT COUNT(*) AS count FROM categories WHERE parentId=?`,args:[id]});
  if(Number(kids.rows[0]?.count||0))throw new StoreError("Нельзя удалить категорию с подкатегориями. Сначала удалите или перенесите их.",409);
  const r=await db.execute({sql:`SELECT COUNT(*) AS count FROM products WHERE categoryId=?`,args:[id]});
  if(Number(r.rows[0]?.count||0))throw new StoreError("Нельзя удалить категорию с товарами.",409);
  await db.execute({sql:`DELETE FROM categories WHERE id=?`,args:[id]});
}

export type CategoryNode=Category&{children:Category[];productCount:number};
/** Дерево для витрины: опубликованные главные категории с подкатегориями и числом товаров. */
export async function getCategoryTree():Promise<CategoryNode[]>{
  const all=await getCategories();
  const counts=await db.execute(`SELECT categoryId,COUNT(*) AS c FROM products WHERE isPublished=1 GROUP BY categoryId`);
  const own=new Map(counts.rows.map(r=>[String(r.categoryId),Number(r.c)]));
  const mains=all.filter(c=>!c.parentId);
  return mains.map(m=>{
    const children=all.filter(c=>c.parentId===m.id);
    const productCount=(own.get(m.id)||0)+children.reduce((s,c)=>s+(own.get(c.id)||0),0);
    return {...m,children,productCount};
  });
}
/** Цепочка для хлебных крошек: [главная] или [главная, подкатегория]. */
export async function getCategoryPath(slug:string):Promise<Category[]>{
  const cat=await getCategoryBySlug(slug);
  if(!cat)return [];
  const parent=cat.parentId?await getCategoryById(cat.parentId):undefined;
  return parent?[parent,cat]:[cat];
}

export type ProductQuery={categorySlug?:string;categoryId?:string;search?:string;featured?:boolean;brand?:string;minPrice?:number;maxPrice?:number;inStock?:boolean;sort?:"price-asc"|"price-desc"|"name"|"newest";limit?:number;ids?:string[];type?:ItemType};
function mapProduct(x:Record<string,unknown>):Product{return {...x,images:parseJson<string[]>(x.images,[]),specifications:parseJson<Record<string,string>>(x.specifications,{}),price:Number(x.price),previousPrice:x.previousPrice==null?null:Number(x.previousPrice),featured:Number(x.featured||0),rating:Number(x.rating||0),stock:Number(x.stock||0),isPublished:Number(x.isPublished??1),type:x.type==="service"?"service":"product"} as Product}
export async function getProducts(q:ProductQuery={}){await ready();const w:string[]=["p.isPublished=1"];const a:(string|number)[]=[];if(q.categorySlug){w.push("(c.slug=? OR c.parentId=(SELECT id FROM categories WHERE slug=?))");a.push(q.categorySlug,q.categorySlug)}if(q.type){w.push("p.type=?");a.push(q.type)}if(q.categoryId){w.push("p.categoryId=?");a.push(q.categoryId)}if(q.search){w.push("(p.name LIKE ? OR p.description LIKE ? OR p.sku LIKE ? OR p.brand LIKE ?)");const s=`%${q.search}%`;a.push(s,s,s,s)}if(q.featured)w.push("p.featured=1");if(q.brand){w.push("p.brand=?");a.push(q.brand)}if(q.minPrice!==undefined){w.push("p.price>=?");a.push(q.minPrice)}if(q.maxPrice!==undefined){w.push("p.price<=?");a.push(q.maxPrice)}if(q.inStock)w.push("p.stock>0");if(q.ids?.length){w.push(`p.id IN (${q.ids.map(()=>"?").join(",")})`);a.push(...q.ids)}const order=q.sort==="price-asc"?"p.price ASC":q.sort==="price-desc"?"p.price DESC":q.sort==="name"?"p.name ASC":"datetime(p.createdAt) DESC";const limit=Math.min(100,Math.max(1,q.limit??100));const r=await db.execute({sql:`SELECT p.*,c.name AS categoryName,c.slug AS categorySlug FROM products p JOIN categories c ON c.id=p.categoryId WHERE ${w.join(" AND ")} ORDER BY ${order} LIMIT ?`,args:[...a,limit]});return r.rows.map(x=>mapProduct(row<Record<string,unknown>>(x)))}
export async function getProductsSafe(q:ProductQuery={}){return getProducts(q)}
export async function getCategoriesSafe(){return getCategories()}
export async function getAllProducts(){return getProducts({limit:100})}
export async function getProductBySlug(slug:string){await ready();const r=await db.execute({sql:`SELECT p.*,c.name AS categoryName,c.slug AS categorySlug FROM products p JOIN categories c ON c.id=p.categoryId WHERE p.slug=? LIMIT 1`,args:[slug]});return r.rows[0]?mapProduct(row<Record<string,unknown>>(r.rows[0])):undefined}
export async function getProductById(id:string){await ready();const r=await db.execute({sql:`SELECT p.*,c.name AS categoryName,c.slug AS categorySlug FROM products p JOIN categories c ON c.id=p.categoryId WHERE p.id=? LIMIT 1`,args:[id]});return r.rows[0]?mapProduct(row<Record<string,unknown>>(r.rows[0])):undefined}
export async function getProductBrands(categorySlug?:string){const ps=await getProducts({categorySlug,limit:100});return [...new Set(ps.map(p=>p.brand).filter(Boolean))].sort()}
export async function createProduct(p:{slug:string;name:string;shortDescription?:string;description?:string;sku?:string;brand?:string;images?:string[];specifications?:Record<string,string>;price:number;previousPrice?:number|null;image?:string;sourceUrl?:string;categoryId:string;featured?:number;rating?:number;stock?:number;isPublished?:number;type?:ItemType}){
  await ready();
  const id=randomUUID();
  const type:ItemType=p.type==="service"?"service":"product";
  const stock=type==="service"?SERVICE_VIRTUAL_STOCK:(p.stock||0);
  await db.execute({sql:`INSERT INTO products(id,slug,name,shortDescription,description,sku,brand,images,specifications,price,previousPrice,image,sourceUrl,categoryId,featured,rating,stock,isPublished,type,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,args:[id,p.slug,p.name,p.shortDescription||"",p.description||p.shortDescription||"",p.sku||"",p.brand||"",JSON.stringify(p.images||[]),JSON.stringify(p.specifications||{}),p.price,p.previousPrice??null,p.image||p.images?.[0]||"",p.sourceUrl||"",p.categoryId,p.featured||0,p.rating||0,stock,p.isPublished===0?0:1,type,now()]});
  return getProductById(id);
}
export async function updateProductById(id:string,p:Partial<Product>){await ready();const map:any={slug:p.slug,name:p.name,shortDescription:p.shortDescription,description:p.description,sku:p.sku,brand:p.brand,images:p.images?JSON.stringify(p.images):undefined,specifications:p.specifications?JSON.stringify(p.specifications):undefined,price:p.price,previousPrice:p.previousPrice,image:p.image,sourceUrl:p.sourceUrl,categoryId:p.categoryId,featured:p.featured,rating:p.rating,stock:p.type==="service"?SERVICE_VIRTUAL_STOCK:p.stock,isPublished:p.isPublished,type:p.type===undefined?undefined:(p.type==="service"?"service":"product")};const s:string[]=[];const a:any[]=[];for(const [k,v] of Object.entries(map))if(v!==undefined){s.push(`${k}=?`);a.push(v)}if(s.length){a.push(id);await db.execute({sql:`UPDATE products SET ${s.join(",")} WHERE id=?`,args:a})}return getProductById(id)}
export async function deleteProductById(id:string){await ready();await db.execute({sql:`DELETE FROM products WHERE id=?`,args:[id]})}

export async function getUserByEmail(email:string){await ready();const r=await db.execute({sql:`SELECT * FROM users WHERE lower(email)=? LIMIT 1`,args:[email.trim().toLowerCase()]});return r.rows[0]?row<User>(r.rows[0]):undefined}
export async function getUserByPhone(phone:string){await ready();const n=normalizeTajikPhone(phone);if(!n)return undefined;const r=await db.execute(`SELECT * FROM users`);return r.rows.map(x=>row<User>(x)).find(u=>normalizeTajikPhone(u.phone||"")===n)}
export async function getUserById(id:string){await ready();const r=await db.execute({sql:`SELECT * FROM users WHERE id=? LIMIT 1`,args:[id]});return r.rows[0]?row<User>(r.rows[0]):undefined}
export async function createUser(p:{firstName:string;lastName:string;email:string;phone:string;passwordHash:string;role?:UserRole}){await ready();const id=randomUUID();await db.execute({sql:`INSERT INTO users(id,firstName,lastName,email,phone,passwordHash,role,createdAt) VALUES(?,?,?,?,?,?,?,?)`,args:[id,p.firstName,p.lastName,p.email.toLowerCase(),p.phone,p.passwordHash,p.role||"USER",now()]});return getUserById(id)}
export async function createAdminUser(p:{name:string;email:string;passwordHash:string},actorId:string){const [firstName,...rest]=p.name.trim().split(/\s+/);const user=await createUser({firstName:firstName||"HASI",lastName:rest.join(" "),email:p.email,phone:"",passwordHash:p.passwordHash,role:"ADMIN"});if(!user)throw new StoreError("Не удалось создать администратора.",500);return user}
export async function updateUserProfile(userId:string,p:{firstName?:string;lastName?:string;phone?:string|null;avatar?:string|null}){await ready();const s:string[]=[];const a:any[]=[];for(const k of ["firstName","lastName","phone","avatar"] as const)if(p[k]!==undefined){s.push(`${k}=?`);a.push(p[k])}if(s.length){a.push(userId);await db.execute({sql:`UPDATE users SET ${s.join(",")} WHERE id=?`,args:a})}return getUserById(userId)}
export async function updateUserPassword(userId:string,newPasswordHash:string){await ready();await db.execute({sql:`UPDATE users SET passwordHash=? WHERE id=?`,args:[newPasswordHash,userId]})}
export async function updateAccountPassword(userId:string,passwordHash:string){return updateUserPassword(userId,passwordHash)}
export function getPublicUser(u:User){return {id:u.id,firstName:u.firstName,lastName:u.lastName,email:u.email,phone:u.phone,role:u.role,avatar:u.avatar,emailVerified:u.emailVerified,isBlocked:u.isBlocked,createdAt:u.createdAt,name:getUserDisplayName(u)}}
export function getUserDisplayName(u:{firstName:string;lastName:string}){return `${u.firstName} ${u.lastName}`.trim()}
export async function getAdminUsers(search=""){await ready();const r=await db.execute({sql:`SELECT * FROM users WHERE (?='' OR lower(email) LIKE lower(?) OR firstName LIKE ? OR lastName LIKE ?) ORDER BY createdAt DESC`,args:[search,`%${search}%`,`%${search}%`,`%${search}%`]});return r.rows as unknown as User[]}
export async function updateAdminUser(id:string,actorId:string,p:Partial<User>){await ready();const keys=["firstName","lastName","email","phone","role","avatar","emailVerified","isBlocked"] as const;const s:string[]=[];const a:any[]=[];for(const k of keys)if(p[k]!==undefined){s.push(`${k}=?`);a.push(p[k])}if(s.length){a.push(id);await db.execute({sql:`UPDATE users SET ${s.join(",")} WHERE id=?`,args:a})}return getUserById(id)}
export async function deleteAdminUser(id:string,actorId:string){await ready();await db.execute({sql:`DELETE FROM users WHERE id=?`,args:[id]})}

async function codeHash(code:string){return createHmac("sha256",getCodeSecret()).update(code).digest("hex")}
function makeCode(){return String(randomInt(100000,1000000))}
async function issueCode(table:string,keyCol:string,keyVal:string,userId:string){await ready();const code=makeCode(),hash=await codeHash(code),expires=new Date(Date.now()+10*60*1000).toISOString(),next=new Date(Date.now()+60*1000).toISOString();await db.execute({sql:`INSERT INTO ${table}(${keyCol},userId,codeHash,expiresAt,nextResendAt,dailyCount,dailyWindow,attempts,createdAt) VALUES(?,?,?,?,?,1,?,0,?) ON CONFLICT(${keyCol}) DO UPDATE SET codeHash=excluded.codeHash,expiresAt=excluded.expiresAt,nextResendAt=excluded.nextResendAt,attempts=0,createdAt=excluded.createdAt`,args:[keyVal,userId,hash,expires,next,new Date().toISOString().slice(0,10),now()]});return code}
export async function issuePasswordResetCode(email:string){const u=await getUserByEmail(email);if(!u)throw new StoreError("Пользователь не найден.",404);return issueCode("passwordResetCodes","email",u.email,u.id)}
export async function issuePhonePasswordResetCode(phone:string){const u=await getUserByPhone(phone);if(!u)throw new StoreError("Пользователь не найден.",404);return issueCode("phonePasswordResetCodes","phone",u.phone,u.id)}
export async function verifyPasswordResetCode(emailOrPhone:string,code:string){await ready();const email=emailOrPhone.includes("@");const table=email?"passwordResetCodes":"phonePasswordResetCodes",key=email?emailOrPhone.toLowerCase():normalizeTajikPhone(emailOrPhone)||emailOrPhone;const r=await db.execute({sql:`SELECT * FROM ${table} WHERE ${email?"email":"phone"}=? LIMIT 1`,args:[key]});const x=r.rows[0];if(!x||new Date(String(x.expiresAt)).getTime()<Date.now())return false;return (await codeHash(code))===String(x.codeHash)}
export async function completePasswordReset(email:string,code:string,passwordHash:string){if(!await verifyPasswordResetCode(email,code))throw new StoreError("Неверный или просроченный код.",400);const u=await getUserByEmail(email);if(!u)throw new StoreError("Пользователь не найден.",404);await updateUserPassword(u.id,passwordHash);await db.execute({sql:`DELETE FROM passwordResetCodes WHERE email=?`,args:[email.toLowerCase()]})}
export async function completePhonePasswordReset(phone:string,code:string,passwordHash:string){if(!await verifyPasswordResetCode(phone,code))throw new StoreError("Неверный или просроченный код.",400);const u=await getUserByPhone(phone);if(!u)throw new StoreError("Пользователь не найден.",404);await updateUserPassword(u.id,passwordHash);await db.execute({sql:`DELETE FROM phonePasswordResetCodes WHERE phone=?`,args:[normalizeTajikPhone(phone)||phone]})}
export async function invalidatePasswordResetCode(email:string){await ready();await db.execute({sql:`DELETE FROM passwordResetCodes WHERE email=?`,args:[email.toLowerCase()]})}
export async function invalidateRegistrationCode(email:string){await ready();await db.execute({sql:`DELETE FROM pendingRegistrations WHERE email=?`,args:[email.toLowerCase()]})}
export async function issueRegistrationCode(p:{email:string;firstName:string;lastName:string;phone:string;passwordHash:string}){
  await ready();
  const code = makeCode();
  const hash = await codeHash(code);
  const email = p.email.toLowerCase();
  await db.execute({
    sql: `INSERT INTO 
pendingRegistrations(email,firstName,lastName,phone,passwordHash,codeHash,expiresAt,nextResendAt,dailyCount,dailyWindow,attempts,createdAt) 
VALUES(?,?,?,?,?,?,?,?,1,?,0,?) ON CONFLICT(email) DO UPDATE SET 
firstName=excluded.firstName,lastName=excluded.lastName,phone=excluded.phone,passwordHash=excluded.passwordHash,codeHash=excluded.codeHash,expiresAt=excluded.expiresAt,nextResendAt=excluded.nextResendAt,attempts=0,createdAt=excluded.createdAt`,
    args: [
      email,
      p.firstName,
      p.lastName,
      p.phone,
      p.passwordHash,
      hash,
      new Date(Date.now()+10*60*1000).toISOString(),
      new Date(Date.now()+60*1000).toISOString(),
      new Date().toISOString().slice(0,10),
      now()
    ]
  });
  return code;
}
export async function resendRegistrationCode(email:string){const r=await db.execute({sql:`SELECT * FROM pendingRegistrations WHERE email=?`,args:[email.toLowerCase()]});const x=r.rows[0];if(!x)throw new StoreError("Регистрация не найдена.",404);return issueRegistrationCode({email:String(x.email),firstName:String(x.firstName),lastName:String(x.lastName),phone:String(x.phone),passwordHash:String(x.passwordHash)})}
export async function verifyRegistrationCode(email:string,code:string){await ready();const r=await db.execute({sql:`SELECT * FROM pendingRegistrations WHERE email=?`,args:[email.toLowerCase()]});const x=r.rows[0];if(!x||new Date(String(x.expiresAt)).getTime()<Date.now()||await codeHash(code)!==String(x.codeHash))throw new StoreError("Неверный или просроченный код.",400);const u=await createUser({firstName:String(x.firstName),lastName:String(x.lastName),email:String(x.email),phone:String(x.phone),passwordHash:String(x.passwordHash)});await invalidateRegistrationCode(email);return u}
export async function issueEmailChangeCode(userId:string,email:string){const u=await getUserById(userId);if(!u)throw new StoreError("Пользователь не найден.",404);await ready();const code=makeCode(),hash=await codeHash(code),expires=new Date(Date.now()+10*60*1000).toISOString(),next=new Date(Date.now()+60*1000).toISOString();await db.execute({sql:`INSERT INTO emailChangeCodes(userId,email,codeHash,expiresAt,nextResendAt,dailyCount,dailyWindow,attempts,createdAt) VALUES(?,?,?,?,?,1,?,0,?) ON CONFLICT(userId) DO UPDATE SET email=excluded.email,codeHash=excluded.codeHash,expiresAt=excluded.expiresAt,nextResendAt=excluded.nextResendAt,attempts=0,createdAt=excluded.createdAt`,args:[userId,email.toLowerCase(),hash,expires,next,new Date().toISOString().slice(0,10),now()]});return code}
export async function invalidateEmailChangeCode(userId:string){await ready();await db.execute({sql:`DELETE FROM emailChangeCodes WHERE userId=?`,args:[userId]})}
export async function verifyEmailChangeCode(userId:string,email:string,code:string){await ready();const r=await db.execute({sql:`SELECT * FROM emailChangeCodes WHERE userId=? AND email=?`,args:[userId,email.toLowerCase()]});const x=r.rows[0];if(!x||new Date(String(x.expiresAt)).getTime()<Date.now()||await codeHash(code)!==String(x.codeHash))throw new StoreError("Неверный или просроченный код.",400);await db.execute({sql:`UPDATE users SET email=? WHERE id=?`,args:[email.toLowerCase(),userId]});await invalidateEmailChangeCode(userId);return getUserById(userId)}

export async function addFavorite(userId:string,productId:string){await ready();await db.execute({sql:`INSERT INTO userFavorites(userId,productId,createdAt) VALUES(?,?,?) ON CONFLICT(userId,productId) DO NOTHING`,args:[userId,productId,now()]})}
export async function getUserFavorites(userId:string){
  await ready();
  const r = await db.execute({
    sql: `SELECT p.*, c.name AS categoryName, c.slug AS categorySlug 
          FROM userFavorites f 
          JOIN products p ON p.id = f.productId 
          JOIN categories c ON c.id = p.categoryId 
          WHERE f.userId = ? 
          ORDER BY f.createdAt DESC`,
    args: [userId]
  });
  return r.rows.map(x => mapProduct(row<Record<string,unknown>>(x)));
}

export async function saveActivity(actorId:string|null,action:string,message:string){await ready();await db.execute({sql:`INSERT INTO activityLogs(id,actorId,action,message,createdAt) VALUES(?,?,?,?,?)`,args:[randomUUID(),actorId,action,message,now()]})}
export async function deleteActivityLog(id:string){await ready();await db.execute({sql:`DELETE FROM activityLogs WHERE id=?`,args:[id]})}
export async function clearActivityLogs(){await ready();const r=await db.execute(`DELETE FROM activityLogs`);return r.rowsAffected}

export async function setSetting(key:string,value:string){await ready();await db.execute({sql:`INSERT INTO settings(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`,args:[key,value,now()]})}
export async function getSetting(key:string){await ready();const r=await db.execute({sql:`SELECT value FROM settings WHERE key=?`,args:[key]});return r.rows[0]?String(r.rows[0].value):null}
export async function getSiteSettings(){await ready();const r=await db.execute(`SELECT key,value FROM settings`);return Object.fromEntries(r.rows.map(x=>[String(x.key),String(x.value??"")]))}

export async function getCart(userId:string):Promise<CartLine[]>{await ready();const r=await db.execute({sql:`SELECT c.quantity,p.*,cat.name AS categoryName,cat.slug AS categorySlug FROM cartItems c JOIN products p ON p.id=c.productId JOIN categories cat ON cat.id=p.categoryId WHERE c.userId=? ORDER BY c.updatedAt DESC`,args:[userId]});return r.rows.map(x=>({...mapProduct(row<Record<string,unknown>>(x)),quantity:Number(x.quantity),categoryName:String(x.categoryName),categorySlug:String(x.categorySlug)} as CartLine))}
export async function setCartQuantity(userId:string,productId:string,quantity:number){await ready();if(quantity<=0)return removeCartItem(userId,productId);const p=await getProductById(productId);if(!p)throw new StoreError("Товар не найден.",404);if(quantity>p.stock)throw new StoreError("Недостаточно товара на складе.",409);await db.execute({sql:`INSERT INTO cartItems(userId,productId,quantity,updatedAt) VALUES(?,?,?,?) ON CONFLICT(userId,productId) DO UPDATE SET quantity=excluded.quantity,updatedAt=excluded.updatedAt`,args:[userId,productId,quantity,now()]})}
export async function removeCartItem(userId:string,productId:string){await ready();await db.execute({sql:`DELETE FROM cartItems WHERE userId=? AND productId=?`,args:[userId,productId]})}

export async function createOrder(p:{userId?:string|null;firstName:string;lastName:string;phone:string;address:string;city:string;email?:string;comment?:string;items:CheckoutItem[]}){await ready();if(!p.items.length)throw new StoreError("Корзина пуста.",400);let total=0;const lines:any[]=[];for(const i of p.items){const product=await getProductById(i.productId);if(!product)throw new StoreError("Товар не найден.",404);if(i.quantity<1||i.quantity>product.stock)throw new StoreError(`Недостаточно товара «${product.name}».`,409);const line=product.price*i.quantity;total+=line;lines.push({product,i,line})}const id=randomUUID();const n=`HASI-${Date.now().toString().slice(-8)}`;await db.execute({sql:`INSERT INTO orders(id,orderNumber,userId,firstName,lastName,phone,address,city,email,comment,total,status,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,args:[id,n,p.userId||null,p.firstName,p.lastName,p.phone,p.address,p.city,p.email||"",p.comment||"",total,"new",now()]});for(const l of lines)await db.execute({sql:`INSERT INTO orderItems(id,orderId,productId,sku,name,image,unitPrice,quantity,lineTotal) VALUES(?,?,?,?,?,?,?,?,?)`,args:[randomUUID(),id,l.product.id,l.product.sku,l.product.name,l.product.image,l.product.price,l.i.quantity,l.line]});if(p.userId)await db.execute({sql:`DELETE FROM cartItems WHERE userId=?`,args:[p.userId]});return getOrderById(id)}
export async function getOrderById(id:string):Promise<Order|undefined>{await ready();const r=await db.execute({sql:`SELECT * FROM orders WHERE id=?`,args:[id]});const x=r.rows[0];if(!x)return undefined;const items=await db.execute({sql:`SELECT * FROM orderItems WHERE orderId=? ORDER BY rowid`,args:[id]});return {...row<Omit<Order,"items">>(x),items:row<OrderItem[]>(items.rows)}}
export async function getOrders():Promise<Order[]>{await ready();const r=await db.execute(`SELECT * FROM orders ORDER BY datetime(createdAt) DESC`);return Promise.all(r.rows.map(async x=>({...row<Omit<Order,"items">>(x),items:row<OrderItem[]>((await db.execute({sql:`SELECT * FROM orderItems WHERE orderId=? ORDER BY rowid`,args:[x.id]})).rows)})))}
export async function getUserOrders(userId:string):Promise<Order[]>{await ready();const r=await db.execute({sql:`SELECT * FROM orders WHERE userId=? ORDER BY datetime(createdAt) DESC`,args:[userId]});return Promise.all(r.rows.map(async x=>({...row<Omit<Order,"items">>(x),items:row<OrderItem[]>((await db.execute({sql:`SELECT * FROM orderItems WHERE orderId=? ORDER BY rowid`,args:[x.id]})).rows)})))}
export async function updateOrderStatus(id:string,status:string){if(!orderStatusValues.includes(status as OrderStatus))throw new StoreError("Недопустимый статус заказа.",400);await ready();const r=await db.execute({sql:`SELECT status FROM orders WHERE id=?`,args:[id]});if(!r.rows[0])throw new StoreError("Заказ не найден.",404);await db.execute({sql:`UPDATE orders SET status=? WHERE id=?`,args:[status,id]});return getOrderById(id)}
export async function cancelUserOrder(userId:string,orderId:string){const o=await getOrderById(orderId);if(!o||o.userId!==userId)throw new StoreError("Заказ не найден.",404);if(o.status==="completed"||o.status==="cancelled")throw new StoreError("Заказ нельзя отменить.",409);await updateOrderStatus(orderId,"cancelled");await saveActivity(userId,"order-cancel",`Пользователь отменил заказ ${orderId}`)}
export async function deleteUserOrder(userId:string,orderId:string){const o=await getOrderById(orderId);if(!o||o.userId!==userId)throw new StoreError("Заказ не найден.",404);if(o.status!=="cancelled")throw new StoreError("Удалить можно только отменённый заказ.",409);await db.execute({sql:`DELETE FROM orders WHERE id=?`,args:[orderId]})}
export async function deleteOrderById(id:string,actorId:string|null=null){const o=await getOrderById(id);if(!o)throw new StoreError("Заказ не найден.",404);await db.execute({sql:`DELETE FROM orders WHERE id=?`,args:[id]});await saveActivity(actorId,"order-delete",`Администратор удалил заказ ${o.orderNumber||id}`)}
export async function getDashboardOverview(){await ready();const [u,c,p,o,recent]=await Promise.all([db.execute(`SELECT COUNT(*) AS count FROM users`),db.execute(`SELECT COUNT(*) AS count FROM categories`),db.execute(`SELECT COUNT(*) AS count FROM products`),db.execute(`SELECT COUNT(*) AS count FROM orders`),db.execute(`SELECT id,orderNumber,total,status,createdAt FROM orders ORDER BY datetime(createdAt) DESC LIMIT 10`)]);return {users:Number(u.rows[0]?.count||0),categories:Number(c.rows[0]?.count||0),products:Number(p.rows[0]?.count||0),orders:Number(o.rows[0]?.count||0),recent:recent.rows}}

const contact=(x:any):ContactMessage=>({...x,isReplied:Boolean(Number(x.isReplied)),reply:String(x.replyText||x.reply||"")});
export async function saveContactMessage(p:{name:string;email:string;phone:string;message:string;userId?:string|null}){await ready();const id=randomUUID(),token=randomBytes(24).toString("hex");await db.execute({sql:`INSERT INTO contactMessages(id,name,email,phone,message,status,reply,replyText,isReplied,repliedAt,userId,visitorToken,createdAt) VALUES(?,?,?,?,?,'NEW','','',0,NULL,?,?,?)`,args:[id,p.name.trim(),p.email.trim().toLowerCase(),p.phone.trim(),p.message.trim(),p.userId||null,token,now()]});return {id,createdAt:now(),visitorToken:token}}
export async function getContactMessages(){await ready();const r=await db.execute(`SELECT * FROM contactMessages ORDER BY datetime(createdAt) DESC LIMIT 200`);return r.rows.map(contact)}
export async function getContactMessageById(id:string){await ready();const r=await db.execute({sql:`SELECT * FROM contactMessages WHERE id=?`,args:[id]});return r.rows[0]?contact(r.rows[0]):undefined}
export async function getContactMessagesForVisitor(items:Array<{id:string;token:string}>,userId?:string|null){await ready();const found=new Map<string,PublicContactMessage>();for(const i of items.slice(0,50)){const r=await db.execute({sql:`SELECT * FROM contactMessages WHERE id=?`,args:[i.id]});const x=r.rows[0];if(x&&x.visitorToken&&x.visitorToken===i.token)found.set(String(x.id),{id:String(x.id),message:String(x.message),status:x.status as ContactMessageStatus,replyText:String(x.replyText||""),isReplied:Boolean(Number(x.isReplied)),repliedAt:x.repliedAt?String(x.repliedAt):null,createdAt:String(x.createdAt)})}if(userId){const r=await db.execute({sql:`SELECT * FROM contactMessages WHERE userId=? ORDER BY datetime(createdAt) DESC LIMIT 100`,args:[userId]});for(const x of r.rows)found.set(String(x.id),{id:String(x.id),message:String(x.message),status:x.status as ContactMessageStatus,replyText:String(x.replyText||""),isReplied:Boolean(Number(x.isReplied)),repliedAt:x.repliedAt?String(x.repliedAt):null,createdAt:String(x.createdAt)})}return [...found.values()].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))}
export type PublicContactMessage={id:string;message:string;status:ContactMessageStatus;replyText:string;isReplied:boolean;repliedAt:string|null;createdAt:string};
export async function updateContactMessageStatus(id:string,status:ContactMessageStatus){if(!contactMessageStatuses.includes(status))throw new StoreError("Недопустимый статус сообщения.",400);const r=await db.execute({sql:`UPDATE contactMessages SET status=? WHERE id=?`,args:[status,id]});if(r.rowsAffected===0)throw new StoreError("Сообщение не найдено.",404);return getContactMessageById(id)}
export async function deleteContactMessage(id:string){const r=await db.execute({sql:`DELETE FROM contactMessages WHERE id=?`,args:[id]});if(r.rowsAffected===0)throw new StoreError("Сообщение не найдено.",404)}
export async function saveContactReply(id:string,reply:string){if(!reply.trim())throw new StoreError("Введите текст ответа.",400);const r=await db.execute({sql:`UPDATE contactMessages SET replyText=?,reply=?,isReplied=1,repliedAt=?,status='ANSWERED' WHERE id=?`,args:[reply.trim(),reply.trim(),now(),id]});if(!r.rowsAffected)throw new StoreError("Сообщение не найдено.",404);return getContactMessageById(id)}
export async function getTokenForUser(user:User){return signToken({id:user.id,email:user.email,role:user.role,name:getUserDisplayName(user)})}
export async function deleteOwnAccount(userId:string){const u=await getUserById(userId);if(!u)throw new StoreError("Пользователь не найден.",404);if(u.role==="ADMIN"){const r=await db.execute({sql:`SELECT COUNT(*) AS count FROM users WHERE role='ADMIN' AND isBlocked=0 AND id!=?`,args:[userId]});if(!Number(r.rows[0]?.count))throw new StoreError("Нельзя удалить единственного администратора.",409)}await db.execute({sql:`UPDATE orders SET userId=NULL WHERE userId=?`,args:[userId]});await db.execute({sql:`DELETE FROM users WHERE id=?`,args:[userId]});return u}

export function saveMemoryUser(u:User){return u}
export async function findMemoryUserByEmail(email:string){return getUserByEmail(email)}
export async function findMemoryUserByPhone(phone:string){return getUserByPhone(phone)}
export async function findFallbackAdminByEmail(email:string){const e=email.toLowerCase();if(e!==(process.env.HASI_ADMIN_EMAIL||process.env.ADMIN_EMAIL||"admin@hasi.tj").toLowerCase() && e!==REQUESTED_ADMIN_EMAIL.toLowerCase())return undefined;return {id:`fallback-${e}`,firstName:"HASI",lastName:"Admin",email:e,phone:"",passwordHash:await bcrypt.hash(e===REQUESTED_ADMIN_EMAIL.toLowerCase()?(process.env.HASI_REQUESTED_ADMIN_PASSWORD||process.env.HASI_ADMIN_PASSWORD||"HasiAdmin@2026"):(process.env.HASI_ADMIN_PASSWORD||process.env.ADMIN_PASSWORD||"admin123"),10),role:"ADMIN" as const,avatar:null,emailVerified:1,isBlocked:0,createdAt:now()}}
export async function verifyFallbackAdmin(email:string,password:string){const u=await findFallbackAdminByEmail(email);if(!u)return null;return await bcrypt.compare(password,u.passwordHash)?u:null}

export type PendingRegistration={email:string;firstName:string;lastName:string;phone:string;passwordHash:string;codeHash:string;expiresAt:string;nextResendAt:string;dailyCount:number;dailyWindow:string;attempts:number};

export async function removeFavorite(userId:string,productId:string){
  await ready();
  await db.execute({
    sql: `DELETE FROM userFavorites WHERE userId=? AND productId=?`,
    args: [userId, productId]
  });
}
