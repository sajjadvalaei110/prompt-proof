import os
import re

for root, _, files in os.walk("src"):
    for file in files:
        if file.endswith(".tsx") or file.endswith(".ts"):
            path = os.path.join(root, file)
            with open(path, "r") as f:
                content = f.read()
            
            # Remove "import React from 'react';"
            content = re.sub(r"import React from 'react';\n", "", content)
            # Change "import React, { useState } from 'react';" to "import { useState } from 'react';"
            content = re.sub(r"import React,\s*\{", "import {", content)
            # Fix types imports
            content = content.replace("../../types", "@/types")
            
            with open(path, "w") as f:
                f.write(content)

with open("src/vite-env.d.ts", "w") as f:
    f.write('/// <reference types="vite/client" />\n')
