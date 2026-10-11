// Sample application data + declaration text. Replace SAMPLE with your API data (same shape).
export const SAMPLE = {
  sections: [
    {
      title: "Personal details",
      fields: [
        ["DP Internal Reference Number", ""], ["BO ID", ""],
        ["BO Type", "Individual"], ["BO Category", "Regular"],
        ["Name of the First Holder", "Md Abu Sayem"], ["Contact Person", ""],
        ["Sex Code", "Male"], ["Date of Birth / Registration", "2000-01-04"],
        ["Father / Husband Name", "MD SANOWAR HOSEN"], ["Mother Name", "MST SHIRINA BEGUM"],
        ["Occupation", "Govt Service"], ["Residency", "RB"],
        ["Citizen of", "BANGLADESH"],
        ["Address", "56/6 fulbaria by-lane , akua, mymensingh sadar"],
        ["City", "Bandarban"], ["State / Division", "Chittagong"],
        ["Country", "Bangladesh"], ["Postal Code", "2204"],
        ["Mobile", "01568768127"], ["Email", "sayem.qax@gmail.com"],
        ["Fax", ""], ["Statement Cycle", "End of Day"],
        ["First Holder National ID", "0000000003"],
        ["#", "Short name"],
        ["First Holder", "Md Abu Sayem"], ["Second Holder", ""], ["Third Holder", ""],
      ],
    },
    {
      title: "KYC information",
      fields: [
        ["TIN", ""], ["MD/CEO (Company / Institution / Firm)", ""],
        ["Nature of Business (Company / Institution / Firm)", ""],
        ["Source of Fund", "SALARY"],
        ["Annual Transactions (Approximate)", "0"],
        ["UNSCRs check done?", "NO"],
        ["Domestic sanction list check done?", "NO"],
        ["Is the customer an IP / PEP?", "NO"],
        ["Adverse media news against?", "NO"],
        ["Beneficial ownership checked?", "NO"],
        ["Visa / Residential and work permit?", "YES"],
      ],
    },
    {
      title: "Passport details",
      fields: [
        ["Passport Number", ""], ["Issue Date of Passport", "1900-01-01"],
        ["Expiry Date of Passport", "1900-01-01"], ["Issue Place of Passport", ""],
      ],
    },
    {
      title: "Bank details",
      fields: [
        ["Routing No", "047274244"], ["Bank Name", "BANGLADESH DEVELOPMENT BANK LTD."],
        ["Bank Branch", "MOTIJHEEL"], ["Account No", "0000000000000"],
      ],
    },
    {
      title: "Other information",
      fields: [
        ["Link BO", "false"], ["Link BOID", ""],
        ["Reference BO", ""], ["Reference", ""],
        ["City Infinity – Mobile App", "true"],
      ],
    },
    {
      title: "Applicant permanent address",
      fields: [
        ["Permanent Address", "56/6 fulbaria by-lane , akua, mymensingh sadar"],
        ["Country", "Bangladesh"], ["State", "Chittagong"],
        ["City", "Bandarban"], ["Postal Code", "2204"],
      ],
    },
    {
      title: "Nominee information",
      fields: [
        ["#", "Nominee 1"],
        ["Name", "Md Abu Sayem"], ["Father Name", "tt"],
        ["Mother Name", "tt"], ["Spouse Name", "tt"],
        ["NID", "11121111111"], ["Mobile Number", "01894623348"],
        ["Gender", "Male"], ["Birthdate", "2000-01-05"],
        ["Share Percent", "100"], ["Relationship", "tt"],
        ["Address", "room 29 , 135/E south kamlapur , sardar colony , motijheel"],
        ["Country", ""], ["State", ""], ["City", ""], ["Zip Code", "1217"],
      ],
    },
    {
      title: "Online payment information",
      fields: [
        ["Payment Type", "EFTN"], ["Amount", "0"],
        ["Transaction ID", ""], ["Transaction Date", "1-01-01"],
      ],
    },
  ],
  documents: {
    "Applicant's image": "", "Applicant's NID": "", "Applicant's NID (back)": "",
    "Applicant's cheque": "", "Nominee image": "", "Nominee NID / Birth ID": "",
    "Nominee NID / Birth ID (back)": "", "Nominee signature": "",
  },
  applicantSignature: "",
};

export const DECLARATION =
  "The rules and regulations of the Depository and CDBL Participant pertaining to an account which are in force now have been read by me/us and I/we have understood the same and I/we agree to abide by and to be bound by the rules as are in force from time to time for such accounts. I/We also declare that the particulars given by me/us are true to the best of my/our knowledge as on the date of making such application. I/We further agree that any false/misleading information given by me/us or suppression of any material fact will render my/our account liable for termination and further action.";