export type SaleForm = {
  status: string
  action: string
  company: string
  branch: string
  prdct: string
  prdctType: string
  saleDt: Date
  offrDt: Date
  clientId?: number
  userId?: number
  agntFirstName?: string
  clientFirstName?: string
  clientLastName?: string
  idNum?: number
  pay: number
}

export type TypePrdct = {
  company: string
  branch: string
  prdct: string
  prdctType: string
  amount: number
  status: string
}

export type saleObj = {
  users: {
    userId: string
    userPrcnt?: string
    user2Id?: string
    user2Prcnt?: string
  }
  offrDt: Date
  handlerId?: string

  clientId?: number

  cmsn?: number

  prdcts: {
    company: string
    branch: string
    prdct: string
    prdctType?: string
    amount?: number
    status: string
    notes?: string
    saleDt?: Date
    rwrd?: boolean
    cmsn?: number
  }[]
  saleId?: number
  rwrd?: boolean
}

export type singleSaleObj = {
  details: {
    userId: string
    userPrcnt?: string
    user2Id?: string
    user2Prcnt?: string
    offrDt: string
    clientFirstName: string
    clientLastName: string
    idNum: string
  }
  prdcts: {
    company: string
    branch: string
    prdct: string
    prdctType: string
    pay: string
    status: string
  }
}

export type userType = {
  id: number
  name: string
}

export type DeletedSale = {
  id: number
  userId: number
  user2Id: number
  userPrcnt: number
  user2Prcnt: number
  offrDt: Date
  clientId: number
  company: string
  branch: string
  prdct: string
  prdctType: string
  pay: number
  status: string
  saleDt: Date
  action: string
  createdAt: Date
  client: {
    id: number
    details: string
  }
  user: {
    id: number
    name: string
  }
  user2: {
    id: number
    name: string
  }
}

export type SaleTableData = {
  id: number
  action: string
  offrDt: Date
  prdct: string
  prdctType: string
  pay: number
  status: string
  branch: string
  company: string
  client: {
    id: number
    details: string
    firstName: string
    lastName: string
    idNum: number
  }
  user: {
    id: number
    name: string
  }
  user2: {
    id: number
    name: string
  }
}

export type User = {
  id: number
  email: string
  role: string
  name: string
  picture?: string
  expires?: string
  iat?: number
  exp?: number
}

export type EditSale = {
  company: string
  branch: string
  prdct: string
  prdctType: string
  status: string
  pay: number
}

export type UserList = {
  id: number
  name: string
}[]
