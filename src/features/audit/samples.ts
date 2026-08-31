import type { Language } from "./types";

export const SAMPLES: Record<Language, string> = {
  javascript: `// Paste your code here — this sample seeds a few common issues.
var users = ["ada", "linus", "grace"];

for (var i = 0; i < users.length; i++) {
  if (users[i] == "ada") {
    console.log("found ada");
  }
}

setTimeout("doWork()", 1000);

const config = JSON.parse('{"retries": 3, "hosts": ["a", "b",]}');
`,
  typescript: `// TypeScript sample
var count: number = 0;

function tick(n: number) {
  if (n != 0) {
    console.log("tick", n);
  }
}

for (var i = 0; i < 10; i++) tick(i);
`,
  python: `# Python sample

def add_user(name, users=[]):
    users.append(name)
    return users

print "hello"

if value == None:
    pass
`,
  java: `// Java sample
public class Demo {
  public static void main(String[] args) {
    String name = "ada";
    if (name == "ada") {
      System.out.println("hi ada");
    }
    try {
      run();
    } catch (Exception e) {
      // swallow
    }
  }
}
`,
  csharp: `// C# sample
using System;

class Demo {
  static void Main() {
    string name = null;
    if (name == null) {
      Console.WriteLine("no name");
    }
    var items = new System.Collections.ArrayList();
    items.Add("hi");
  }
}
`,
  go: `// Go sample
package main

import "fmt"

func Run(items []interface{}) {
  fmt.Println("items:", items)
  for i := 0; i < len(items); i++ {
    fmt.Println(items[i])
  }
}
`,
  rust: `// Rust sample
fn parse(input: &str) -> i32 {
    let n = input.parse::<i32>().unwrap();
    println!("parsed {}", n);
    n
}
`,
  ruby: `# Ruby sample
def find(name)
  users = load_users()
  puts "searching"
  begin
    users.detect { |u| u == nil }
  rescue Exception => e
    nil
  end
end
`,
  php: `<?php
// PHP sample
$name = $_GET["name"];
if ($name == "ada") {
    var_dump($name);
}
$rows = mysql_query("SELECT * FROM users");
`,
  sql: `-- SQL sample
SELECT * FROM orders WHERE status = 'open';

UPDATE users SET active = false;

DELETE FROM sessions;
`,
};
