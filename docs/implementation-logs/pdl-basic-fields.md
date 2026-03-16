Person Starter
base Bundle
id
A unique persistent identifier for the person

full_name
The person's full name

first_name
The person's first name

middle_initial
The first letter of the person's middle name

middle_name
The person's middle name

last_initial
The first letter of the person's last name

last_name
The person's last name

sex
The person's biological sex

birth_year
True/False
The year the person was born

birth_date
True/False
The day the person was born

linkedin_url
The person's current LinkedIn profile URL. This is null when no values in the "profiles" array are active.

linkedin_username
The person's LinkedIn profile username. This is null when no values in the "profiles" array are active.

linkedin_id
The person's LinkedIn profile ID. This is null when no values in the "profiles" array are active.

facebook_url
The person's Facebook profile URL based on source agreement

facebook_username
The person's Facebook profile username based on source agreement

facebook_id
The person's Facebook profile ID based on source agreement

twitter_url
The person's Twitter profile URL based on source agreement

twitter_username
The person's Twitter profile username based on source agreement

github_url
The person's GitHub profile URL based on source agreement

github_username
The person's GitHub profile username based on source agreement

work_email
True/False
The person's current work email

personal_emails
True/False
All personal emails associated with the person

recommended_personal_email
True/False
The best available email to reach a person

mobile_phone
True/False
The direct-dial mobile phone associated with this person.

industry
The most relevant industry for this person based on their work history

job_title
The person's current job title

job_title_role
The derived role of the person's current job title

job_title_sub_role
The derived subrole of the person's current job title

job_title_class
The line item category this employee would fall into.

job_title_levels
The derived level(s) of the person's current job title

job_company_id
The person's current company's PDL ID

job_company_name
The person's current company's name

job_company_website
The person's current company's website

job_company_size
The person's current company's size range

job_company_founded
The person's current company's founding year

job_company_industry
The person's current company's industry

job_company_industry_v2

job_company_linkedin_url
The person's current company's LinkedIn URL

job_company_linkedin_id
The person's current company's LinkedIn ID

job_company_facebook_url
The person's current company's Facebook URL

job_company_twitter_url
The person's current company's Twitter URL

job_company_location_name
The person's current company's headquarters' location name

job_company_location_locality
The person's current company's headquarters' locality

job_company_location_metro
The person's current company's headquarters' metro area

job_company_location_region
The person's current company's headquarters' region

job_company_location_geo
The person's current company's headquarters' city-center geographic coordinates

job_company_location_street_address
The person's current company's headquarters' street address

job_company_location_address_line_2
The person's current company's headquarters' street address line 2

job_company_location_postal_code
The person's current company's headquarters' postal code

job_company_location_country
The person's current company's headquarters' country

job_company_location_continent
The person's current company's headquarters' continent

job_last_changed
The timestamp that reflects when the top-level job information changed.

job_last_verified
The timestamp that reflects when the information on the top level job information has been last validated by a data source.

job_start_date
The date the person started their current job

location_name
True/False
The location of the person's current address

location_locality
True/False
The locality of the person's current address

location_metro
True/False
The metro of the person's current address

location_region
True/False
The region of the person's current address

location_country
The country of the person's current address

location_continent
The continent of the person's current address

location_street_address
True/False
The person's current street address

location_address_line_2
The person's current street address line 2

location_postal_code
True/False
The postal code of the person's current address

location_geo
True/False
The geo code of the city center of the person's current address

location_last_updated
The timestamp that a new data source contributed to the record for the person's current address

phone_numbers
True/False
All phone numbers associated with the person

emails
True/False
Email addresses associated with the person

emails.address
True/False
The fully parsed email address

emails.type
True/False
The type of email

interests
The person's self-reported interests

skills
The person's self-reported skills

location_names
True/False
All location names associated with the person

regions
True/False
All regions associated with the person

countries
All countries associated with the person

street_addresses
True/False
All street addresses associated with the person

street_addresses.address_line_2
True/False
The street address line 2

street_addresses.continent
True/False
The continent the address is in

street_addresses.country
True/False
The country the address is in

street_addresses.geo
True/False
The city-center geographic coordinates of the address

street_addresses.locality
True/False
The locality the address is in

street_addresses.metro
True/False
The metro area the address is in

street_addresses.name
True/False
The location of the address

street_addresses.postal_code
True/False
The postal code of the address

street_addresses.region
True/False
The region of the address

street_addresses.street_address
True/False
The street address

experience
The person's work experience

experience.company
The company where the person worked

experience.company.facebook_url
The company's Facebook URL

experience.company.founded
The founding year of the company

experience.company.id
The company's PDL ID

experience.company.industry
The self-identified industry of the company

experience.company.industry_v2

experience.company.linkedin_id
The company's LinkedIn ID

experience.company.linkedin_url
The company's LinkedIn URL

experience.company.location
The location of the company's headquarters

experience.company.location.address_line_2
The street address line 2 of the company HQ address

experience.company.location.continent
The continent the company HQ is in

experience.company.location.country
The country the company HQ is in

experience.company.location.geo
City-center geo code of the company HQ, in the format "latitude, longitude"

experience.company.location.locality
The locality the company HQ is in

experience.company.location.metro
The metro area the company HQ is in

experience.company.location.name
Our cleaned values for the company HQ location in the format "locality, region, country"

experience.company.location.postal_code
The postal code of the company HQ address

experience.company.location.region
The region the company HQ is in

experience.company.location.street_address
The street address of the company HQ

experience.company.name
The company name, cleaned and standardized

experience.company.size
The self-reported company size range

experience.company.twitter_url
The company's Twitter URL

experience.company.website
The company's primary website, cleaned and standardized

experience.end_date
The date the person left the company

experience.is_primary
Whether this is the person's current job or not

experience.location_names
Locations where the person has worked while with this company (if different from the company HQ)

experience.start_date
The date the person started at the company

experience.title
The person's job title while at the company

experience.title.class
The line item category this employee would fall into.

experience.title.levels
The level(s) of the job title

experience.title.name
The cleaned job title

experience.title.role
One of the Canonical Job Roles

experience.title.sub_role
One of the Canonical Job Sub Roles

education
The person's education information

education.degrees
The degrees the person earned at the school

education.end_date
The date the person left the school

education.gpa
The GPA the person earned at the school

education.majors
All majors the person earned at the school

education.minors
All minors the person earned at the school

education.school
The school the person attended

education.school.domain
The primary website domain associated with the school

education.school.facebook_url
The school's Facebook URL

education.school.id
The non-persistent ID for the school in our records

education.school.linkedin_id
The school's LinkedIn ID

education.school.linkedin_url
The school's LinkedIn URL

education.school.location
The location of the school

education.school.location.continent
The continent the school is in

education.school.location.country
The country the school is in

education.school.location.locality
The locality the school is in

education.school.location.name
Our cleaned values for the school location in the format "locality, region, country"

education.school.location.region
The region the school is in

education.school.name
The name of the school

education.school.twitter_url
The school's Twitter URL

education.school.type
The school type

education.school.website
The website URL associated with the school

education.start_date
The date the person started at the school

profiles
Social profiles associated with the person

profiles.id
The profile ID (format varies based on social network).

profiles.network
The social network the profile is on

profiles.url
The profile URL

profiles.username
The profile username

dataset_version
The major or minor release number
View Example