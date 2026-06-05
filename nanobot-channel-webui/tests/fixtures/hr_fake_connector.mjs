const rows = {
  companies: [
    { id: "c1", name: "乐潮里科技有限公司", short_name: null },
    { id: "c2", name: "武汉未来天空音乐文化产业有限公司", short_name: null },
    { id: "c3", name: "武汉赢城集团有限公司", short_name: null }
  ],
  departments: [
    { id: "d1", name: "元宇宙", company_id: "c1" },
    { id: "d2", name: "策划部", company_id: "c1" },
    { id: "d3", name: "人力资源部", company_id: "c2" },
    { id: "d4", name: "行政部", company_id: "c2" },
    { id: "d5", name: "财务部", company_id: "c3" }
  ]
};

export class SupabaseConnector {
  from(table) {
    return new Query(table);
  }
}

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.orderKey = "";
  }

  select() {
    return this;
  }

  order(key) {
    this.orderKey = key;
    return this;
  }

  eq(key, value) {
    this.filters.push({ type: "eq", key, value });
    return this;
  }

  in(key, values) {
    this.filters.push({ type: "in", key, values });
    return this;
  }

  limit() {
    return this;
  }

  then(resolve) {
    resolve(this.result());
  }

  result() {
    let data = [...(rows[this.table] ?? [])];
    for (const filter of this.filters) {
      if (filter.type === "eq") {
        data = data.filter((row) => row[filter.key] === filter.value);
      }
      if (filter.type === "in") {
        data = data.filter((row) => filter.values.includes(row[filter.key]));
      }
    }
    if (this.table === "departments") {
      data = data.map((row) => ({
        id: row.id,
        name: row.name,
        companies: {
          name: rows.companies.find((company) => company.id === row.company_id)?.name ?? null
        }
      }));
    }
    if (this.orderKey) {
      data.sort((left, right) => String(left[this.orderKey] ?? "").localeCompare(String(right[this.orderKey] ?? ""), "zh-Hans-CN"));
    }
    return { data, error: null };
  }
}
